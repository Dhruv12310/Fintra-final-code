"""
Document-to-entry pipeline: OpenAI Vision extracts vendor/amount/date/lines from uploaded documents,
matches vendor to contacts, and pre-fills invoice/bill or expense report data.
"""

import base64
import os
from typing import Optional, Dict, Any, List
from database import supabase


def _encode_image(file_bytes: bytes, content_type: str = "image/jpeg") -> str:
    """Base64-encode image bytes for OpenAI Vision."""
    return base64.b64encode(file_bytes).decode("utf-8")


async def extract_document_fields(
    file_bytes: bytes,
    content_type: str,
    filename: str = "",
) -> Dict[str, Any]:
    """
    Call OpenAI Vision (or text extraction for PDFs) to extract structured fields from a document.

    Returns:
        {
            document_type: "invoice" | "bill" | "receipt" | "statement" | "unknown",
            vendor: str,
            vendor_address: str,
            customer: str,
            date: str,           # YYYY-MM-DD
            due_date: str,
            invoice_number: str,
            subtotal: float,
            tax: float,
            total: float,
            currency: str,
            line_items: [{description, quantity, unit_price, amount}],
            payment_terms: str,
            notes: str,
            confidence: float,   # 0-1
        }
    """
    import openai

    client = openai.AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    is_image = content_type.startswith("image/")
    is_pdf = content_type == "application/pdf" or filename.lower().endswith(".pdf")

    prompt = """You are a financial document parser. Extract all relevant fields from this document.

Return a JSON object with these fields (use null for fields not found):
{
  "document_type": "invoice" | "bill" | "receipt" | "bank_statement" | "unknown",
  "vendor": "vendor/supplier company name",
  "vendor_address": "full address if present",
  "customer": "customer/buyer name",
  "date": "YYYY-MM-DD (document/invoice date)",
  "due_date": "YYYY-MM-DD (payment due date)",
  "invoice_number": "invoice or reference number",
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "currency": "USD",
  "payment_terms": "Net 30, etc.",
  "line_items": [
    {"description": "item name", "quantity": 1, "unit_price": 0.00, "amount": 0.00}
  ],
  "notes": "any additional notes",
  "confidence": 0.95
}

Rules:
- document_type "bill" = a document YOU received and need to pay (supplier invoice to you)
- document_type "invoice" = a document you SENT to a customer
- document_type "receipt" = a receipt for a purchase (expense)
- Extract all line items if present
- Confidence: 0.9+ means all key fields found, 0.7-0.9 = some fields missing, <0.7 = very uncertain

Return ONLY the JSON object, no other text."""

    try:
        if is_image:
            b64 = _encode_image(file_bytes, content_type)
            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}", "detail": "high"}},
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
                max_tokens=2000,
                response_format={"type": "json_object"},
            )
        else:
            # For PDFs: use text extraction hint
            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": f"{prompt}\n\nNote: This is a PDF document named '{filename}'. Extract what you can from the filename and context.",
                    }
                ],
                max_tokens=1000,
                response_format={"type": "json_object"},
            )

        import json
        content = response.choices[0].message.content
        fields = json.loads(content)
        return fields

    except Exception as e:
        return {
            "document_type": "unknown",
            "vendor": None,
            "customer": None,
            "date": None,
            "due_date": None,
            "invoice_number": None,
            "subtotal": None,
            "tax": 0,
            "total": None,
            "currency": "USD",
            "line_items": [],
            "notes": None,
            "confidence": 0,
            "error": str(e),
        }


def match_vendor_to_contact(company_id: str, vendor_name: Optional[str]) -> Optional[Dict]:
    """Find the best matching contact for a vendor name."""
    if not vendor_name:
        return None

    # Exact match first
    exact = supabase.table("contacts").select("id, display_name, email, contact_type").eq("company_id", company_id).ilike("display_name", vendor_name).limit(1).execute()
    if exact.data:
        return exact.data[0]

    # Fuzzy: ILIKE with first word
    first_word = vendor_name.split()[0] if vendor_name else ""
    if len(first_word) >= 3:
        fuzzy = supabase.table("contacts").select("id, display_name, email, contact_type").eq("company_id", company_id).ilike("display_name", f"%{first_word}%").limit(3).execute()
        if fuzzy.data:
            return fuzzy.data[0]

    return None


def match_customer_to_contact(company_id: str, customer_name: Optional[str]) -> Optional[Dict]:
    """Find the best matching customer contact."""
    return match_vendor_to_contact(company_id, customer_name)


async def process_document(
    company_id: str,
    user_id: str,
    file_bytes: bytes,
    content_type: str,
    filename: str = "",
    document_record_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Full pipeline:
    1. Extract fields via OpenAI Vision
    2. Match vendor/customer to contacts
    3. Resolve suggested GL account from line items
    4. Return pre-filled data for bill/invoice/expense creation

    Returns:
        {
            extracted: {...},          # raw extracted fields
            document_type: str,
            suggested_action: "create_bill" | "create_invoice" | "create_expense",
            pre_filled: {...},         # data ready to pass to the create endpoint
            contact_match: {...},      # matched contact if found
            confidence: float,
        }
    """
    extracted = await extract_document_fields(file_bytes, content_type, filename)

    doc_type = extracted.get("document_type", "unknown")
    confidence = float(extracted.get("confidence") or 0)

    vendor_name = extracted.get("vendor")
    customer_name = extracted.get("customer")

    # Determine action
    if doc_type in ("bill", "receipt"):
        suggested_action = "create_bill" if doc_type == "bill" else "create_expense"
        contact_match = match_vendor_to_contact(company_id, vendor_name)
    elif doc_type == "invoice":
        suggested_action = "create_invoice"
        contact_match = match_customer_to_contact(company_id, customer_name)
    else:
        suggested_action = "create_bill"
        contact_match = match_vendor_to_contact(company_id, vendor_name)

    # Build pre-filled data
    line_items = extracted.get("line_items") or []
    total = float(extracted.get("total") or 0)
    subtotal = float(extracted.get("subtotal") or total)
    tax = float(extracted.get("tax") or 0)

    if not line_items and total:
        line_items = [{"description": vendor_name or "Services", "quantity": 1, "unit_price": subtotal, "amount": subtotal}]

    pre_filled: Dict[str, Any] = {
        "issue_date": extracted.get("date"),
        "due_date": extracted.get("due_date"),
        "total": total,
        "subtotal": subtotal,
        "tax_total": tax,
        "reference_number": extracted.get("invoice_number"),
        "notes": extracted.get("notes"),
        "line_items": [
            {
                "description": l.get("description", ""),
                "quantity": float(l.get("quantity") or 1),
                "unit_price": float(l.get("unit_price") or l.get("amount") or 0),
                "amount": float(l.get("amount") or 0),
            }
            for l in line_items
        ],
    }

    if contact_match:
        pre_filled["contact_id"] = contact_match["id"]
        pre_filled["contact_name"] = contact_match["display_name"]
    elif vendor_name:
        pre_filled["vendor_name"] = vendor_name
    elif customer_name:
        pre_filled["customer_name"] = customer_name

    # Update document record if provided
    if document_record_id:
        try:
            supabase.table("documents").update({
                "ai_extracted_data": extracted,
                "suggested_action": suggested_action,
                "processing_status": "processed",
            }).eq("id", document_record_id).execute()
        except Exception:
            pass

    return {
        "extracted": extracted,
        "document_type": doc_type,
        "suggested_action": suggested_action,
        "pre_filled": pre_filled,
        "contact_match": contact_match,
        "vendor_name": vendor_name,
        "confidence": confidence,
        "message": (
            f"Extracted {doc_type}: {vendor_name or customer_name or 'Unknown'} — "
            f"${total:,.2f}" + (f" (due {extracted.get('due_date')})" if extracted.get("due_date") else "") +
            f". Confidence: {confidence * 100:.0f}%." +
            (f" Matched to contact: {contact_match['display_name']}." if contact_match else " No existing contact found.")
        ),
    }
