"""Atlas CMMS client — backward-compatibility shim.

The real implementation is in cmms/atlas.py (AtlasCMMS class).
This module re-exports module-level functions for existing server.py imports.
"""

from __future__ import annotations

from cmms.atlas import AtlasCMMS

_adapter = AtlasCMMS()

# Re-export as module-level async functions for backward compatibility
list_work_orders = _adapter.list_work_orders
create_work_order = _adapter.create_work_order
complete_work_order = _adapter.complete_work_order
list_assets = _adapter.list_assets
get_asset = _adapter.get_asset
list_pm_schedules = _adapter.list_pm_schedules
invite_users = _adapter.invite_users
health_check = _adapter.health_check
