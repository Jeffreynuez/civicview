from fastapi import APIRouter, HTTPException
from app.services.states_service import StatesService

router = APIRouter()
service = StatesService()


@router.get("/{state_code}")
async def get_state_info(state_code: str):
    """Get state legislature and election information."""
    state_code = state_code.upper()
    data = service.get_state_data(state_code)
    if not data:
        raise HTTPException(status_code=404, detail=f"No data for state {state_code}")
    return data
