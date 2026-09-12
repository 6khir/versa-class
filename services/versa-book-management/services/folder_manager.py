import os
import re
import shutil
from config import BASE_TPT_PATH

SLOT_COUNT = 1000
SLOT_NAME = re.compile(r'^P\d{4}$')
_active_root = None


def pack_slot_name(num):
    return f"P{int(num):04d}"


def set_active_root(base_path=None):
    global _active_root
    root = str(base_path or '').strip()
    _active_root = root or None
    return _active_root


def resolve_root(base_path=None):
    root = str(base_path or _active_root or BASE_TPT_PATH or '').strip()
    if not root:
        raise ValueError('Choose a book-management root first.')
    return root


def ensure_pack_slots(base_path=None, count=SLOT_COUNT):
    """Create empty unpublished P0001–P1000 slots. No titles. No Notion writes."""
    root = resolve_root(base_path)
    set_active_root(root)
    total = max(1, min(int(count or SLOT_COUNT), SLOT_COUNT))
    os.makedirs(root, exist_ok=True)
    created = 0
    for index in range(1, total + 1):
        name = pack_slot_name(index)
        full_path = os.path.join(root, name)
        book_path = os.path.join(full_path, 'Book')
        smm_path = os.path.join(full_path, 'SMM')
        existed = os.path.isdir(full_path)
        os.makedirs(book_path, exist_ok=True)
        os.makedirs(smm_path, exist_ok=True)
        if not existed:
            created += 1
    return {
        'root_path': root,
        'count': total,
        'created': created,
        'first': pack_slot_name(1),
        'last': pack_slot_name(total)
    }


def get_next_available_folder(base_path=None):
    """Finds the next empty P00XX folder for a new export."""
    root = resolve_root(base_path)
    ensure_pack_slots(root)
    for index in range(1, SLOT_COUNT + 1):
        name = pack_slot_name(index)
        full_path = os.path.join(root, name)
        book_path = os.path.join(full_path, 'Book')
        smm_path = os.path.join(full_path, 'SMM')
        os.makedirs(book_path, exist_ok=True)
        os.makedirs(smm_path, exist_ok=True)
        if _folder_is_empty(book_path):
            return {
                'product_id': name,
                'root_path': full_path,
                'book_path': book_path,
                'smm_path': smm_path
            }
    last = pack_slot_name(SLOT_COUNT)
    full_path = os.path.join(root, last)
    return {
        'product_id': last,
        'root_path': full_path,
        'book_path': os.path.join(full_path, 'Book'),
        'smm_path': os.path.join(full_path, 'SMM')
    }

def _folder_is_empty(path):
    if not os.path.isdir(path):
        return True
    try:
        return not any(os.scandir(path))
    except OSError:
        return True

def list_local_books(query='', base_path=None):
    """List P0XXX slots on disk so the export picker works without Notion."""
    needle = str(query or '').strip().lower()
    try:
        root = resolve_root(base_path)
    except ValueError:
        return []
    if not os.path.exists(root):
        return []

    books = []
    for name in sorted(os.listdir(root)):
        full_path = os.path.join(root, name)
        if not os.path.isdir(full_path) or not SLOT_NAME.match(name):
            continue
        book_path = os.path.join(full_path, 'Book')
        smm_path = os.path.join(full_path, 'SMM')
        record = {
            'product_id': name,
            'name': '',
            'root_path': full_path,
            'book_path': book_path,
            'smm_path': smm_path,
            'empty': _folder_is_empty(book_path),
            'status': 'Not Published',
            'source': 'local'
        }
        haystack = f"{record['product_id']} {record['name']}".lower()
        if needle and needle not in haystack:
            continue
        books.append(record)
    return books

def route_export_to_folder(source_file_path, product_id=None):
    """Routes an exported book to the correct folder. If no product_id is provided, gets the next available one."""
    if not product_id:
        folder_info = get_next_available_folder()
    else:
        full_path = os.path.join(resolve_root(), product_id)
        book_path = os.path.join(full_path, "Book")
        os.makedirs(book_path, exist_ok=True)
        folder_info = {
            "product_id": product_id,
            "root_path": full_path,
            "book_path": book_path,
            "smm_path": os.path.join(full_path, "SMM")
        }
        
    filename = os.path.basename(source_file_path)
    destination = os.path.join(folder_info['book_path'], filename)
    
    # In a real scenario, this moves the file. For backend, we simulate or execute shutil.move
    try:
        shutil.move(source_file_path, destination)
    except FileNotFoundError:
        pass # Handle based on actual integration
        
    return folder_info
