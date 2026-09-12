from flask import Flask, jsonify, request, make_response
import subprocess
import os
from services.notion_api import get_all_products, update_product_field, create_product
from config import NOTION_TOKEN
from services.folder_manager import get_next_available_folder, list_local_books, route_export_to_folder, ensure_pack_slots, set_active_root

app = Flask(__name__)

@app.route('/')
def index():
    # Read the file directly to avoid Jinja2 parsing Vue syntax ({{ ... }})
    with open(os.path.join(app.root_path, 'templates', 'index.html'), 'r') as f:
        html_content = f.read()
    
    resp = make_response(html_content)
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    return resp

@app.route('/api/products', methods=['GET'])
def api_get_products():
    return jsonify(get_all_products())

@app.route('/api/update', methods=['POST'])
def api_update_product():
    req = request.json
    field_type = req.get('type', 'number')
    success = update_product_field(req['page_id'], req['field'], req['value'], field_type)
    return jsonify({"success": success})

@app.route('/api/open', methods=['POST'])
def api_open_folder():
    url = request.json.get('url', '')
    if url.startswith('tpt://'):
        import urllib.parse
        path = urllib.parse.unquote(url.replace('tpt://', '', 1))
        subprocess.run(['open', path])
    return jsonify({"success": True})

@app.route('/api/integration/health', methods=['GET'])
def integration_health():
    return jsonify({"status": "ok", "service": "versa-book-management"})

@app.route('/api/integration/books', methods=['GET'])
def integration_books():
    query = (request.args.get('q') or '').strip()
    books = list_local_books(query)
    notion_ok = bool(NOTION_TOKEN)
    try:
        products = get_all_products() or []
        if not NOTION_TOKEN:
            products = []
        by_id = {item.get('product_id'): item for item in products if item.get('product_id')}
        for book in books:
            extra = by_id.pop(book['product_id'], None)
            if not extra:
                continue
            book['name'] = extra.get('name') or book.get('name') or ''
            book['status'] = extra.get('status') or book.get('status') or 'Not Published'
            book['page_id'] = extra.get('id')
        for extra in by_id.values():
            haystack = f"{extra.get('product_id') or ''} {extra.get('name') or ''}".lower()
            if query and query.lower() not in haystack:
                continue
            books.append({
                'product_id': extra.get('product_id') or '',
                'name': extra.get('name') or extra.get('product_id') or 'Untitled',
                'root_path': '',
                'book_path': extra.get('book_url') or '',
                'smm_path': extra.get('smm_url') or '',
                'empty': False,
                'source': 'notion',
                'status': extra.get('status') or '',
                'page_id': extra.get('id')
            })
    except Exception:
        notion_ok = False
    books.sort(key=lambda item: item.get('product_id') or '')
    return jsonify({"status": "success", "books": books, "notion": notion_ok})

@app.route('/api/integration/available_folder', methods=['GET'])
def get_available_folder():
    root = (request.args.get('root_path') or request.args.get('rootPath') or '').strip()
    folder_info = get_next_available_folder(root or None)
    return jsonify({"status": "success", "folder_info": folder_info, "message": f"Folder {folder_info['product_id']} is ready for export."})

@app.route('/api/integration/set_root', methods=['POST'])
def set_root():
    data = request.json or {}
    root = (data.get('root_path') or data.get('rootPath') or '').strip()
    if not root:
        return jsonify({"status": "error", "message": "Pick a root."}), 400
    set_active_root(root)
    return jsonify({"status": "success", "root_path": root})

@app.route('/api/integration/bootstrap', methods=['POST'])
def bootstrap_slots():
    data = request.json or {}
    root = (data.get('root_path') or data.get('rootPath') or '').strip()
    count = data.get('count') or 1000
    info = ensure_pack_slots(root or None, count)
    return jsonify({
        "status": "success",
        "notion": False,
        "message": f"Created {info['created']} empty slots {info['first']}\u2013{info['last']}.",
        **info
    })

@app.route('/api/integration/register_export', methods=['POST'])
def register_export():
    data = request.json or {}
    linked = create_product(data.get("product_id"), data.get("book_path"), data.get("smm_path"), name=data.get("book_name", "New Exported Book"))
    return jsonify({
        "status": "success",
        "message": "Successfully linked." if linked else "Saved to the management folder.",
        "notion": bool(linked)
    })

if __name__ == '__main__':
    debug = os.environ.get('VERSA_BOOK_MGMT_DEBUG', '0') == '1'
    port = int(os.environ.get('VERSA_BOOK_MGMT_PORT', '5000'))
    app.run(host='127.0.0.1', port=port, debug=debug, use_reloader=False)
