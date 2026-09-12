import requests
from config import NOTION_TOKEN, NOTION_DB_ID

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

def get_all_products():
    if not NOTION_TOKEN:
        return []
    has_more = True
    next_cursor = None
    all_products = []
    
    while has_more:
        payload = {}
        if next_cursor:
            payload['start_cursor'] = next_cursor
            
        res = requests.post(f"https://api.notion.com/v1/databases/{NOTION_DB_ID}/query", headers=HEADERS, json=payload)
        data = res.json()
        
        for page in data.get('results', []):
            props = page['properties']
            try: product_id = props.get('Product ID', {}).get('title', [{}])[0].get('plain_text', '')
            except: product_id = ''
            
            try: name = props.get('Product Name', {}).get('rich_text', [{}])[0].get('plain_text', '')
            except: name = ''
            
            try: status = props.get('Status', {}).get('select', {}).get('name', '')
            except: status = ''
            
            price = props.get('Price', {}).get('number')
            sales = props.get('Sales', {}).get('number')
            book_url = props.get('Folder URL Path', {}).get('url', '')
            smm_url = props.get('SMM Folder Path', {}).get('url', '')
            
            all_products.append({
                'id': page['id'],
                'product_id': product_id,
                'name': name,
                'price': price,
                'sales': sales,
                'status': status,
                'book_url': book_url,
                'smm_url': smm_url
            })
            
        has_more = data.get('has_more', False)
        next_cursor = data.get('next_cursor')
    
    all_products.sort(key=lambda x: x['product_id'])
    return all_products

def update_product_field(page_id, field, value, field_type="number"):
    if field_type == "number":
        updates = {field: {"number": value}}
    elif field_type == "select":
        updates = {field: {"select": {"name": value}}}
    elif field_type == "rich_text":
        updates = {field: {"rich_text": [{"text": {"content": value}}]}}
        
    res = requests.patch(f"https://api.notion.com/v1/pages/{page_id}", headers=HEADERS, json={"properties": updates})
    return res.status_code == 200

def create_product(product_id, book_path, smm_path, name=""):
    if not NOTION_TOKEN:
        return False
    import urllib.parse
    properties = {
        "Product ID": {"title": [{"text": {"content": product_id}}]},
        "Folder URL Path": {"url": f"tpt://{urllib.parse.quote(book_path)}"},
        "SMM Folder Path": {"url": f"tpt://{urllib.parse.quote(smm_path)}"}
    }
    if name:
        properties["Product Name"] = {"rich_text": [{"text": {"content": name}}]}
        
    data = {
        "parent": {"database_id": NOTION_DB_ID},
        "properties": properties
    }
    res = requests.post("https://api.notion.com/v1/pages", headers=HEADERS, json=data)
    return res.status_code in (200, 201)
