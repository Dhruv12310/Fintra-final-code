from supabase import create_client
import os
import platform
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("❌ Missing Supabase credentials. Check your .env file.")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# postgrest-py 0.17.2 hardcodes http2=True in create_session. On Windows this
# causes WinError 10035 (WSAEWOULDBLOCK) when concurrent sync threads share the
# same HTTP/2 connection. Replace the session with an HTTP/1.1-only client.
if platform.system() == "Windows":
    from postgrest.utils import SyncClient
    _old = supabase.postgrest.session
    supabase.postgrest.session = SyncClient(
        base_url=str(_old.base_url),
        headers=dict(_old.headers),
        timeout=_old.timeout,
        follow_redirects=True,
        http2=False,
    )

def table(name: str):
    return supabase.table(name)

print("Supabase connection initialized successfully (using service_role key).")
