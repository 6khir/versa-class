import os

def _load_local_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.isfile(env_path):
        return
    try:
        with open(env_path, 'r', encoding='utf-8') as handle:
            for raw in handle:
                line = raw.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass

_load_local_env()

NOTION_TOKEN = os.environ.get('VERSA_NOTION_TOKEN', '')
NOTION_DB_ID = os.environ.get('VERSA_NOTION_DB_ID', '39e4b3a3-3e67-80f3-9024-dd0157107671')
BASE_TPT_PATH = os.environ.get('VERSA_TPT_PATH', '/Users/abdelmouiz/Downloads/My TPT WORK')
