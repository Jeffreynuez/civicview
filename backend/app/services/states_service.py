"""
State Legislature & Elections Service
Provides state-level political data (sample data for now).
"""


class StatesService:
    def __init__(self):
        self.data = {
            "FL": {
                "name": "Florida",
                "stateLeg": [
                    {"id": "fl-sen-001", "name": "Kathleen Passidomo", "party": "R", "chamber": "State Senate", "district": "28", "role": "President of the Senate"},
                    {"id": "fl-sen-002", "name": "Jason Pizzo", "party": "D", "chamber": "State Senate", "district": "37", "role": "Senator"},
                    {"id": "fl-sen-003", "name": "Lori Berman", "party": "D", "chamber": "State Senate", "district": "26", "role": "Senator"},
                    {"id": "fl-house-001", "name": "Daniel Perez", "party": "R", "chamber": "State House", "district": "116", "role": "Speaker of the House"},
                    {"id": "fl-house-002", "name": "Anna Eskamani", "party": "D", "chamber": "State House", "district": "42", "role": "Representative"},
                    {"id": "fl-house-003", "name": "Randy Fine", "party": "R", "chamber": "State House", "district": "33", "role": "Representative"},
                ],
                "elections": [
                    {"title": "Florida Primary Election", "date": "August 18, 2026", "type": "Primary", "level": "State"},
                    {"title": "Florida General Election", "date": "November 3, 2026", "type": "General", "level": "State"},
                    {"title": "US Congressional Midterms", "date": "November 3, 2026", "type": "General", "level": "Federal"},
                ],
            },
            "TX": {
                "name": "Texas",
                "stateLeg": [
                    {"id": "tx-sen-001", "name": "Brandon Creighton", "party": "R", "chamber": "State Senate", "district": "4", "role": "Senator"},
                    {"id": "tx-house-001", "name": "Dustin Burrows", "party": "R", "chamber": "State House", "district": "83", "role": "Speaker of the House"},
                ],
                "elections": [
                    {"title": "Texas Primary Election", "date": "March 3, 2026", "type": "Primary", "level": "State"},
                    {"title": "Texas General Election", "date": "November 3, 2026", "type": "General", "level": "Federal"},
                ],
            },
            "CA": {
                "name": "California",
                "stateLeg": [
                    {"id": "ca-sen-001", "name": "Mike McGuire", "party": "D", "chamber": "State Senate", "district": "2", "role": "President pro Tempore"},
                    {"id": "ca-asm-001", "name": "Robert Rivas", "party": "D", "chamber": "State Assembly", "district": "29", "role": "Speaker"},
                ],
                "elections": [
                    {"title": "California Primary Election", "date": "June 2, 2026", "type": "Primary", "level": "State"},
                    {"title": "California General Election", "date": "November 3, 2026", "type": "General", "level": "Federal"},
                ],
            },
        }

    def get_state_data(self, state_code: str):
        return self.data.get(state_code)
