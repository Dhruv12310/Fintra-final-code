"""
Agent tool: Document-to-entry pipeline via OpenAI Vision.

Tools:
  process_document    — read/write: extract fields from uploaded document + create bill/invoice/expense (requires_confirmation)
  list_documents      — read: list recently uploaded documents with processing status
"""

from typing import Dict, Any
from database import supabase
from lib.agent.tools.registry import AgentTool, register_tool


async def handle_list_documents(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """List recently uploaded documents."""
    company_id = context["company_id"]
    limit = int(arguments.get("limit", 10))

    rows = supabase.table("documents").select("id, filename, document_type, amount, vendor, issue_date, processing_status, created_at").eq("company_id", company_id).order("created_at", desc=True).limit(limit).execute().data or []

    if not rows:
        return {"count": 0, "documents": [], "message": "No documents uploaded yet."}

    lines = [
        f"  {r.get('filename', 'unnamed')} | {r.get('document_type', '?')} | ${float(r.get('amount') or 0):,.2f} | {r.get('vendor', '?')} | {r.get('processing_status', 'pending')}"
        for r in rows
    ]

    return {
        "count": len(rows),
        "documents": rows,
        "message": f"{len(rows)} document(s):\n" + "\n".join(lines),
    }


async def handle_process_document(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Process a document by ID to extract fields and create a bill/invoice/expense."""
    company_id = context["company_id"]
    user_id = context["user_id"]

    document_id = arguments.get("document_id")
    create_entry = arguments.get("create_entry", False)
    entry_type = arguments.get("entry_type")  # "bill", "invoice", "expense"

    if not document_id:
        return {"error": "document_id is required"}

    # Fetch document record
    doc_r = supabase.table("documents").select("*").eq("id", document_id).eq("company_id", company_id).single().execute()
    if not doc_r.data:
        return {"error": "Document not found"}
    doc = doc_r.data

    # If already processed, return cached extraction
    if doc.get("ai_extracted_data") and not arguments.get("reprocess"):
        extracted = doc["ai_extracted_data"]
        return {
            "document_id": document_id,
            "extracted": extracted,
            "suggested_action": doc.get("suggested_action", "create_bill"),
            "message": f"Document already processed. Type: {doc.get('document_type', '?')}, Amount: ${float(doc.get('amount') or 0):,.2f}. Use create_entry=true to create the entry.",
        }

    # Fetch file from storage
    file_url = doc.get("file_url") or doc.get("url")
    if not file_url:
        return {"error": "Document has no file URL — cannot process"}

    # Download file
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(file_url)
            file_bytes = resp.content
            content_type = resp.headers.get("content-type", "image/jpeg")
    except Exception as e:
        return {"error": f"Failed to download document: {str(e)}"}

    from lib.document_processor import process_document
    result = await process_document(
        company_id=company_id,
        user_id=user_id,
        file_bytes=file_bytes,
        content_type=content_type,
        filename=doc.get("filename", ""),
        document_record_id=document_id,
    )

    if not create_entry:
        return {
            "document_id": document_id,
            **result,
        }

    # Create the entry
    pre_filled = result["pre_filled"]
    action = entry_type or result["suggested_action"]
    entry_result = {}

    if action == "create_bill":
        contact_id = pre_filled.get("contact_id")
        if not contact_id and pre_filled.get("vendor_name"):
            # Create contact
            c = supabase.table("contacts").insert({
                "company_id": company_id,
                "display_name": pre_filled["vendor_name"],
                "contact_type": "vendor",
            }).execute()
            contact_id = c.data[0]["id"] if c.data else None

        bill_data = {
            "company_id": company_id,
            "contact_id": contact_id,
            "vendor_name": pre_filled.get("vendor_name") or pre_filled.get("contact_name"),
            "issue_date": pre_filled.get("issue_date"),
            "due_date": pre_filled.get("due_date"),
            "subtotal": pre_filled.get("subtotal") or pre_filled.get("total"),
            "tax_total": pre_filled.get("tax_total") or 0,
            "total": pre_filled.get("total"),
            "balance_due": pre_filled.get("total"),
            "reference_number": pre_filled.get("reference_number"),
            "notes": pre_filled.get("notes"),
            "status": "draft",
            "source": "document_ocr",
        }
        bill_data = {k: v for k, v in bill_data.items() if v is not None}
        r = supabase.table("bills").insert(bill_data).execute()
        if r.data:
            bill = r.data[0]
            # Insert line items
            for line in pre_filled.get("line_items") or []:
                supabase.table("bill_lines").insert({
                    "bill_id": bill["id"],
                    "description": line.get("description", ""),
                    "quantity": line.get("quantity", 1),
                    "unit_price": line.get("unit_price", 0),
                    "amount": line.get("amount", 0),
                }).execute()
            entry_result = {"created": "bill", "bill_id": bill["id"], "total": bill.get("total")}

    elif action == "create_invoice":
        contact_id = pre_filled.get("contact_id")
        inv_data = {
            "company_id": company_id,
            "contact_id": contact_id,
            "customer_name": pre_filled.get("customer_name") or pre_filled.get("contact_name"),
            "issue_date": pre_filled.get("issue_date"),
            "due_date": pre_filled.get("due_date"),
            "subtotal": pre_filled.get("subtotal") or pre_filled.get("total"),
            "tax_total": pre_filled.get("tax_total") or 0,
            "total": pre_filled.get("total"),
            "balance_due": pre_filled.get("total"),
            "reference_number": pre_filled.get("reference_number"),
            "notes": pre_filled.get("notes"),
            "status": "draft",
        }
        inv_data = {k: v for k, v in inv_data.items() if v is not None}
        r = supabase.table("invoices").insert(inv_data).execute()
        if r.data:
            inv = r.data[0]
            entry_result = {"created": "invoice", "invoice_id": inv["id"], "total": inv.get("total")}

    return {
        "document_id": document_id,
        "extracted": result["extracted"],
        "suggested_action": result["suggested_action"],
        "entry_result": entry_result,
        "confidence": result["confidence"],
        "message": result["message"] + (f"\nCreated {action.replace('create_', '')}: ${pre_filled.get('total', 0):,.2f}" if entry_result else ""),
    }


def register():
    register_tool(AgentTool(
        name="list_documents",
        description="List recently uploaded documents with their processing status and extracted amounts.",
        parameters={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Max documents to return. Default 10.", "default": 10},
            },
        },
        handler=handle_list_documents,
        requires_confirmation=False,
    ))

    register_tool(AgentTool(
        name="process_document",
        description=(
            "Process an uploaded document using AI (OCR + extraction): extract vendor, amount, date, "
            "line items. Optionally create a bill, invoice, or expense report from the extracted data. "
            "Use list_documents to find document IDs first."
        ),
        parameters={
            "type": "object",
            "properties": {
                "document_id": {"type": "string", "description": "UUID of the uploaded document"},
                "create_entry": {"type": "boolean", "description": "Whether to create a bill/invoice from the extraction. Default false.", "default": False},
                "entry_type": {"type": "string", "enum": ["create_bill", "create_invoice", "create_expense"], "description": "Force a specific entry type. If omitted, AI decides."},
                "reprocess": {"type": "boolean", "description": "Force re-extraction even if already processed.", "default": False},
            },
            "required": ["document_id"],
        },
        handler=handle_process_document,
        requires_confirmation=True,
    ))
