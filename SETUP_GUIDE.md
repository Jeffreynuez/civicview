# CivicLens - Setup Guide

## Quick Start

### 1. Start the Backend (Python/FastAPI)

```bash
# Open a terminal and navigate to the backend folder
cd CivicLens/backend

# Create a virtual environment
python -m venv venv

# Activate it
# On Windows:
venv\Scripts\activate
# On Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn app.main:app --reload

# You should see: INFO: Uvicorn running on http://127.0.0.1:8000
```

Test it by visiting:
- http://localhost:8000 — Welcome message
- http://localhost:8000/docs — Interactive API docs
- http://localhost:8000/api/congress/members?state=FL — Florida congress members

### 2. Start the Frontend (Next.js/React)

```bash
# Open a SECOND terminal and navigate to the frontend folder
cd CivicLens/frontend

# Install dependencies
npm install

# Run the dev server
npm run dev

# You should see: ▲ Next.js - Local: http://localhost:3000
```

Visit http://localhost:3000 to see CivicLens!

### 3. Using the App

- Click any state on the map to see its elected officials
- The app fetches live data from the Congress.gov API when the backend is running
- If the backend isn't running, the frontend gracefully falls back to sample data
- Click any Congress member to see their full profile (bio, committees, bills, votes)
- Use the tabs to switch between Congress, State Legislature, and Elections
- Use the search bar to find members by name

## Congress.gov API Key

Your API key is already configured in `backend/.env`. If you ever need a new one:
1. Visit https://api.congress.gov/sign-up/
2. Sign up for a free key
3. Replace the value in `backend/.env`

## Project Structure

```
CivicLens/
├── SETUP_GUIDE.md              ← This file
│
├── backend/                     ← Python / FastAPI
│   ├── requirements.txt         ← Python dependencies
│   ├── .env                     ← API key (not committed to git)
│   ├── .env.example             ← Template for API keys
│   └── app/
│       ├── main.py              ← FastAPI entry point & CORS config
│       ├── routers/
│       │   ├── congress.py      ← Congress API endpoints
│       │   └── states.py        ← State data API endpoints
│       └── services/
│           ├── congress_service.py  ← Congress.gov API + caching + fallback
│           └── states_service.py    ← State legislature & election data
│
└── frontend/                    ← JavaScript / Next.js / React
    ├── package.json             ← JavaScript dependencies
    ├── next.config.js           ← Next.js settings
    ├── tailwind.config.js       ← Tailwind CSS theme
    ├── app/
    │   ├── layout.js            ← Root layout
    │   ├── page.js              ← Home page (map + panel)
    │   └── globals.css          ← Global styles
    ├── components/
    │   ├── Navbar.js            ← Top navigation + search
    │   ├── MapView.js           ← Interactive US map (MapLibre)
    │   ├── SidePanel.js         ← Right panel (list + tabs)
    │   ├── PersonCard.js        ← Politician card component
    │   ├── ProfileView.js       ← Detailed politician profile
    │   └── NotificationBanner.js
    └── lib/
        ├── api.js               ← API client (backend + fallback)
        └── constants.js         ← State codes, party colors
```

## What's Next

Future features to build:
1. Address-based district lookup (enter your address → find your specific representatives)
2. User accounts with Supabase (save followed politicians, notification preferences)
3. Push notifications for new legislation and votes
4. More state legislature data via Open States API
5. Campaign finance data via OpenSecrets API
