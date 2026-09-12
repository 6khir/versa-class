import requests
from config import NOTION_TOKEN, NOTION_DB_ID

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

has_more = True
next_cursor = None

while has_more:
    payload = {}
    if next_cursor:
        payload['start_cursor'] = next_cursor
        
    res = requests.post(f"https://api.notion.com/v1/databases/{NOTION_DB_ID}/query", headers=HEADERS, json=payload)
    data = res.json()
    
    for page in data.get('results', []):
        page_id = page['id']
        updates = {
            "Status": {"select": {"name": "Not Published"}}
        }
        requests.patch(f"https://api.notion.com/v1/pages/{page_id}", headers=HEADERS, json={"properties": updates})
        
    has_more = data.get('has_more', False)
    next_cursor = data.get('next_cursor')

print("All set to Not Published!")
