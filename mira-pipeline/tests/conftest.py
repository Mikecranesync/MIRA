"""Put mira-pipeline/ on sys.path so tests can `from qr_bridge import ...`"""
import sys
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
if str(PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_ROOT))
