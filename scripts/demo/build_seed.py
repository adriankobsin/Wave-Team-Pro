"""Builds supabase/demo/02_seed.sql: the fictional Solenne Systems Group for the Wave Team Pro demo.
All companies, people, emails (@solenne.example) and data are invented."""
import json, base64, io, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PASSWORD = "WaveTeamPro-Demo-2026"
DOMAIN = "solenne.example"

def q(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"

ORGS = [  # key, name, slug, currency, tz, country, code, vat
    ("uk", "Solenne Systems Ltd", "solenne-uk", "GBP", "Europe/London", "GB", "SOL-UK", 20),
    ("nl", "Solenne Systems BV", "solenne-nl", "EUR", "Europe/Amsterdam", "NL", "SOL-NL", 21),
    ("sg", "Solenne Systems Pte Ltd", "solenne-sg", "SGD", "Asia/Singapore", "SG", "SOL-SG", 9),
    ("us", "Solenne Systems Inc", "solenne-us", "USD", "America/New_York", "US", "SOL-US", 0),
    ("th", "Solenne Systems Co Ltd", "solenne-th", "THB", "Asia/Bangkok", "TH", "SOL-TH", 7),
]
ORG = {o[0]: o for o in ORGS}
ALL = [o[0] for o in ORGS]

# key: name, tz, [(org, role, job, dept, field_project_or_None, manager_key)]
PEOPLE = {
    "olivia":  ("Olivia Grant", "Europe/London", [(o, "super_admin", "Group CEO", "FIN", None, None) for o in ALL]),
    "priya":   ("Priya Nair", "Asia/Singapore", [(o, "va_admin", "Group PA & Office Manager", "OPS", None, "olivia") for o in ALL]),
    "marcus":  ("Marcus Reid", "Europe/London", [(o, "director", "Operations Director", "OPS", None, "olivia") for o in ("uk", "nl", "us")]),
    "hannah":  ("Hannah Weber", "Europe/Amsterdam", [(o, "hr_manager", "HR Manager", "OPS", None, "olivia") for o in ("uk", "nl")]),
    "sarah":   ("Sarah Bennett", "Europe/London", [(o, "bookkeeper", "Bookkeeper", "FIN", None, "marcus") for o in ("uk", "nl", "us")]),
    "weiling": ("Wei Ling Tan", "Asia/Singapore", [(o, "bookkeeper", "Finance Executive", "FIN", None, "priya") for o in ("sg", "th")]),
    "james":   ("James Holloway", "Europe/London", [("uk", "project_manager", "Project Manager", "ENG", "HHW", "marcus")]),
    "tom":     ("Tom Fletcher", "Europe/London", [("uk", "employee", "Senior AV Engineer", "ENG", "HHW", "james")]),
    "grace":   ("Grace Okafor", "Europe/London", [("uk", "employee", "Network Engineer", "ENG", "KXO", "james")]),
    "liam":    ("Liam Carter", "Europe/London", [("uk", "team_leader", "Installation Team Leader", "ENG", "HHW", "james")]),
    "emma":    ("Emma Visser", "Europe/Amsterdam", [("nl", "project_manager", "Project Manager", "ENG", "ACC", "marcus")]),
    "daan":    ("Daan de Vries", "Europe/Amsterdam", [("nl", "employee", "Systems Engineer", "ENG", "ACC", "emma")]),
    "sofie":   ("Sofie Jansen", "Europe/Amsterdam", [("nl", "employee", "AV Technician", "ENG", "ACC", "emma")]),
    "daniel":  ("Daniel Koh", "Asia/Singapore", [("sg", "project_manager", "Regional Project Manager", "ENG", "MBR", "olivia"),
                                                  ("th", "project_manager", "Regional Project Manager", "ENG", None, "olivia")]),
    "ryan":    ("Ryan Lim", "Asia/Singapore", [("sg", "team_leader", "Site Team Leader", "ENG", "SRW", "daniel")]),
    "arjun":   ("Arjun Menon", "Asia/Singapore", [("sg", "employee", "Network Engineer", "ENG", "SRW", "ryan"),
                                                   ("th", "employee", "Network Engineer", "ENG", None, "somchai")]),
    "nurul":   ("Nurul Aisyah", "Asia/Singapore", [("sg", "employee", "Field Technician", "ENG", "MBR", "ryan")]),
    "michael": ("Michael Brooks", "America/New_York", [("us", "project_manager", "Project Manager", "ENG", "MBH", "marcus")]),
    "jessica": ("Jessica Alvarez", "America/New_York", [("us", "employee", "AV Engineer", "ENG", "MBH", "michael")]),
    "chris":   ("Chris Patel", "America/New_York", [("us", "employee", "Field Technician", "ENG", "MBH", "michael")]),
    "somchai": ("Somchai Prasert", "Asia/Bangkok", [("th", "team_leader", "Site Lead", "ENG", "PVR", "daniel")]),
    "kanya":   ("Kanya Srisuk", "Asia/Bangkok", [("th", "employee", "AV Technician", "ENG", "PVR", "somchai")]),
    "niran":   ("Niran Chaiyaporn", "Asia/Bangkok", [("th", "employee", "Network Engineer", "ENG", "BOT", "somchai")]),
}

# code: org, name, site, status, start_off, end_off, hours, budget, lead, members, description
PROJECTS = {
    "HHW": ("uk", "Harbourside Hotel — guest Wi-Fi & IPTV", "Harbourside Hotel, Canary Wharf, London", "active", -45, 40, 1200, 185000, "james", ["tom", "liam", "grace"],
            "Hotel-wide Wi-Fi 7 network for 412 rooms, IPTV head-end and casting in every room. Phase 1 (floors 1–6) complete; phase 2 floors 7–14 under way."),
    "KXO": ("uk", "King's Cross offices — meeting room AV", "Granary Square, London", "active", -20, 60, 640, 96000, "james", ["grace", "tom"],
            "Fit-out of 28 meeting rooms with Teams Rooms, ceiling microphones and room booking panels for a 900-desk office."),
    "RDM": ("uk", "Royal Docks marina — CCTV upgrade", "Royal Docks Marina, London", "planning", 14, 90, 420, 58000, "james", ["liam"],
            "Replace 64 analogue cameras with 4K IP cameras and pontoon analytics; survey booked."),
    "ACC": ("nl", "Amstel Congress Centre — AV refresh", "Amstel Congress Centre, Amsterdam", "active", -30, 50, 980, 142000, "emma", ["daan", "sofie"],
            "Main hall LED wall, Dante audio network and hybrid-meeting kits for 14 breakout rooms."),
    "RPO": ("nl", "Rotterdam port office — network rebuild", "Port office, Rotterdam", "on_hold", -60, 30, 300, 41000, "emma", ["daan"],
            "Core switch and Wi-Fi replacement; paused until the client's building works finish."),
    "MBR": ("sg", "Marina Bay Residences — smart home systems", "Marina Bay Residences, Singapore", "active", -50, 70, 1500, 420000, "daniel", ["nurul", "arjun", "ryan"],
            "Lighting, climate, AV and door-entry integration for 180 apartments, with a residents' app."),
    "SRW": ("sg", "Sentosa resort — outdoor PA & Wi-Fi", "Sentosa resort, Singapore", "active", -25, 35, 720, 165000, "daniel", ["ryan", "arjun"],
            "Beach-front Wi-Fi, outdoor PA zones and emergency paging for a 260-key resort."),
    "CLH": ("sg", "Changi logistics hub — access control", "Changi logistics hub, Singapore", "completed", -150, -20, 560, 98000, "daniel", ["arjun", "nurul"],
            "Card and face-recognition access control for 42 doors; handed over and in warranty."),
    "MBH": ("us", "Miami Beach hotel — conference AV", "Ocean Drive, Miami Beach, FL", "active", -35, 45, 880, 210000, "michael", ["jessica", "chris"],
            "Ballroom projection, divisible-room audio and 9 meeting rooms with wireless presentation."),
    "FLY": ("us", "Fort Lauderdale yacht club — network & CCTV", "Las Olas, Fort Lauderdale, FL", "planning", 10, 80, 400, 76000, "michael", ["jessica"],
            "Marina-wide Wi-Fi for 120 berths and dockside CCTV."),
    "PVR": ("th", "Phuket villa resort — Wi-Fi & entertainment", "Kamala, Phuket", "active", -40, 55, 1100, 6800000, "somchai", ["kanya", "niran", "arjun"],
            "Wi-Fi, IPTV and in-villa audio for 64 pool villas and the beach club."),
    "BOT": ("th", "Bangkok office tower — digital signage", "Sathorn, Bangkok", "active", -15, 45, 380, 2400000, "somchai", ["niran"],
            "62 lobby and lift-lobby screens with central content management."),
}

# project, title, description, status, priority, due_off, assignees, creator, outcome, outcome_note, checklist, comments[(author, text, hours_ago)]
TASKS = [
    ("HHW", "Install access points on floor 9", "42 Wi-Fi 7 APs per the heat map in the drawings folder. Label each AP with its room number.", "in_progress", "high", 2, ["tom", "liam"], "james", None, None,
        [("Floor 9 east wing", True), ("Floor 9 west wing", False), ("Update AP schedule", False)], [("tom", "East wing done, 21 APs online. Starting west wing tomorrow morning.", 20), ("james", "Great progress. Ceiling void in 912–918 is tight, take the short brackets.", 18)]),
    ("HHW", "Commission IPTV head-end", "Load channel line-up, set up the welcome screen and test on 10 rooms.", "todo", "normal", 6, ["tom"], "james", None, None, [("Channel line-up", False), ("Welcome screen with hotel branding", False)], []),
    ("HHW", "Patch and test floor 8 data cabinets", "Test every port with the Fluke and upload the report.", "done", "normal", -3, ["liam"], "james", "completed", "All 96 ports tested and passed. Report uploaded to the project folder.", [], [("liam", "Two ports failed first time, re-terminated and passed.", 80)]),
    ("HHW", "Fix casting on floor 6 rooms", "Guests in 6xx can't see the TV when casting. Check the multicast settings.", "done", "urgent", -6, ["grace"], "james", "not_completed", "Waiting on the hotel's IT team to open the firewall rule for mDNS between VLANs. Ticket raised with them; I'll finish as soon as they confirm.", [], []),
    ("KXO", "Install Teams Rooms in meeting rooms 3.01–3.08", "Bars, touch panels and ceiling mics. Room list is in the drawings folder.", "in_progress", "high", 4, ["grace", "tom"], "james", None, None, [("3.01–3.04", True), ("3.05–3.08", False), ("Sign-in to Teams with room accounts", False)], [("grace", "3.01 to 3.04 done and tested with a live call.", 6)]),
    ("KXO", "Site survey for level 5 booking panels", None, "todo", "low", 9, ["grace"], "james", None, None, [], []),
    ("RDM", "Survey pontoon camera positions", "Walk the pontoons with the marina manager and mark mounting points.", "todo", "normal", 15, ["liam"], "james", None, None, [], []),
    ("ACC", "Install LED wall controllers in the main hall", "Mount and wire the 4 controllers; calibration is next week.", "in_progress", "high", 3, ["daan", "sofie"], "emma", None, None, [("Rack mounting", True), ("Fibre runs", True), ("Power-on test", False)], [("daan", "Fibre runs done. Waiting on the electrician for the dedicated circuit.", 26)]),
    ("ACC", "Program the Dante audio network", None, "todo", "normal", 8, ["daan"], "emma", None, None, [], []),
    ("ACC", "Hybrid-meeting kits for breakout rooms 1–7", "Install camera, speakerphone and HDMI ingest.", "done", "normal", -2, ["sofie"], "emma", "completed", "Rooms 1–7 done, tested with the client's AV manager. Photos in the notes.", [], []),
    ("RPO", "Agree new start date with the client", None, "todo", "low", 12, ["emma"], "emma", None, None, [], []),
    ("MBR", "Configure lighting scenes for the show apartment", "Morning, evening, movie and away scenes, using the interior designer's spec.", "in_progress", "high", 1, ["nurul"], "daniel", None, None, [("Living room", True), ("Bedrooms", False), ("Away scene + app test", False)], [("nurul", "Living room scenes done. The designer wants the evening scene warmer, adjusting.", 3)]),
    ("MBR", "Install door-entry panels on levels 10–14", None, "todo", "normal", 7, ["arjun", "nurul"], "daniel", None, None, [], []),
    ("MBR", "Level 12 snag list", "Clear the 14 snags from the client walkthrough.", "done", "normal", -1, ["ryan"], "daniel", "completed", "All 14 snags cleared; 2 needed new faceplates. Photos uploaded.", [], [("daniel", "Thanks Ryan, sending the client the sign-off sheet.", 20)]),
    ("SRW", "Weatherproof the beach-front PA speakers", "Fit the marine-grade covers and seal the cable glands before monsoon season.", "in_progress", "urgent", 0, ["ryan", "arjun"], "daniel", None, None, [("Zone A", True), ("Zone B", True), ("Zone C", False)], []),
    ("SRW", "Wi-Fi coverage test at the pool deck", None, "done", "normal", -4, ["arjun"], "daniel", "completed", "Coverage above -65 dBm everywhere except the far cabana; added one outdoor AP.", [], []),
    ("CLH", "Warranty visit: door 17 reader", None, "done", "low", -12, ["arjun"], "daniel", "completed", "Replaced the faulty reader under warranty.", [], []),
    ("MBH", "Ballroom projector alignment", "Edge-blend the two laser projectors for the 12 m screen.", "in_progress", "high", 2, ["jessica"], "michael", None, None, [("Physical alignment", True), ("Edge blending", False)], [("jessica", "Projectors hung and aligned. Edge blending tomorrow once the room is dark.", 5)]),
    ("MBH", "Run cable for divisible-room audio", None, "todo", "normal", 5, ["chris"], "michael", None, None, [], []),
    ("MBH", "Wireless presentation in meeting rooms A–E", None, "done", "normal", -2, ["chris"], "michael", "not_completed", "Rooms A–D done. Room E's display is the wrong model (no HDMI-CEC); the hotel is replacing it on Thursday.", [], []),
    ("FLY", "Prepare the marina Wi-Fi design", None, "todo", "normal", 11, ["michael"], "michael", None, None, [], []),
    ("PVR", "Install IPTV boxes in villas 41–64", None, "in_progress", "high", 3, ["kanya", "niran"], "somchai", None, None, [("Villas 41–52", True), ("Villas 53–64", False)], [("kanya", "Villas 41 to 52 done. Need 4 more HDMI cables from the store.", 4)]),
    ("PVR", "Beach club speaker zones", None, "todo", "normal", 9, ["kanya"], "somchai", None, None, [], []),
    ("PVR", "Core switch configuration", "VLANs per the network design; guest isolation on.", "done", "high", -5, ["arjun"], "somchai", "completed", "Done remotely from Singapore with Niran on site. Config backed up.", [], []),
    ("BOT", "Mount lift-lobby screens floors 20–32", None, "in_progress", "normal", 4, ["niran"], "somchai", None, None, [], []),
    (None, "Prepare November board pack", "Group P&L, project pipeline and headcount.", "todo", "high", 6, ["priya"], "olivia", None, None, [], []),
    (None, "Book the Q4 operations review venue", None, "done", "normal", -3, ["priya"], "olivia", "completed", "Booked the boardroom at the London office plus a Teams link for the other offices.", [], []),
]
TASK_ORG = {None: "uk"}

# Tasks staff added for themselves (personal, or on their project).
OWN_TASKS = [
    ("tom", None, "Renew my IPAF licence", "Course booked for the 18th.", "todo", "normal", 14),
    ("grace", "KXO", "Order spare SFP modules for KXO", None, "in_progress", "normal", 2),
    ("daan", None, "Book NEN 3140 refresher course", None, "todo", "low", 20),
    ("nurul", "MBR", "Upload site photos for level 12", None, "done", "normal", -1),
    ("jessica", "MBH", "Prepare as-built drawings for the ballroom", None, "in_progress", "normal", 5),
    ("kanya", "PVR", "Collect access badges for villa block C", None, "todo", "normal", 1),
    ("liam", None, "Van service and MOT", None, "todo", "normal", 8),
    ("arjun", None, "Finish Cisco CCNP study module 4", None, "in_progress", "low", 10),
]

# person, org, start_off, end_off, status, note, reviewer
LEAVE = [
    ("sofie", "nl", 0, 2, "approved", "Family trip", "emma"),
    ("tom", "uk", 20, 24, "pending", "Christmas shopping week", None),
    ("arjun", "sg", -10, -9, "approved", None, "ryan"),
    ("jessica", "us", 12, 13, "pending", "Moving house", None),
    ("grace", "uk", 30, 34, "approved", None, "james"),
    ("niran", "th", 6, 6, "pending", "Doctor's appointment", None),
    ("chris", "us", -7, -7, "rejected", "Day off", "michael"),
]

# person, org, project, category, merchant, description, total, status, day_off, payment, reimbursed
EXPENSES = [
    ("tom", "uk", "HHW", "Materials", "Screwfix", "Cable ties, fixings and labels for floor 9", 86.40, "submitted", -1, "personal", None),
    ("liam", "uk", "HHW", "Fuel & mileage", "Shell Canary Wharf", "Van fuel", 62.10, "approved", -6, "personal", "paid"),
    ("james", "uk", "KXO", "Accommodation", "Premier Inn King's Cross", "Overnight for the early install", 129.00, "approved", -4, "personal", "pending"),
    ("grace", "uk", "KXO", "Equipment & tools", "CEF", "RJ45 crimp tool and tester", 214.80, "submitted", -2, "personal", None),
    ("tom", "uk", "HHW", "Meals", "Pret A Manger", "Lunch on site", 11.25, "rejected", -5, "personal", None),
    ("daan", "nl", "ACC", "Materials", "Gamma", "Mounting rails", 54.90, "submitted", -1, "personal", None),
    ("sofie", "nl", "ACC", "Travel", "NS", "Train to Amsterdam RAI", 23.40, "approved", -3, "personal", "pending"),
    ("emma", "nl", "ACC", "Accommodation", "Hotel Okura Amsterdam", "Client dinner and overnight", 189.00, "approved", -9, "company_card", None),
    ("nurul", "sg", "MBR", "Travel", "Grab", "Taxi with equipment to site", 18.60, "submitted", -1, "personal", None),
    ("arjun", "sg", "SRW", "Equipment & tools", "Sim Lim Square", "Outdoor AP mounting kit", 342.00, "approved", -5, "personal", "pending"),
    ("ryan", "sg", "MBR", "Meals", "Kopitiam", "Team lunch after handover", 46.80, "approved", -8, "personal", "paid"),
    ("daniel", "sg", "MBR", "Parking & tolls", "Marina Bay Sands car park", "Client meeting", 24.00, "submitted", 0, "personal", None),
    ("jessica", "us", "MBH", "Equipment & tools", "B&H Photo", "Projector lens adapter", 689.00, "submitted", -2, "personal", None),
    ("chris", "us", "MBH", "Travel", "Uber", "Ride to site with the rack", 34.50, "approved", -6, "personal", "paid"),
    ("michael", "us", "MBH", "Accommodation", "Marriott Stanton South Beach", "Two nights on site", 245.00, "submitted", -3, "company_card", None),
    ("kanya", "th", "PVR", "Materials", "HomePro Phuket", "HDMI cables and wall plates", 2450.00, "submitted", -1, "personal", None),
    ("niran", "th", "BOT", "Travel", "Bolt", "Taxi to Sathorn tower", 380.00, "approved", -4, "personal", "paid"),
    ("somchai", "th", "PVR", "Travel", "Bangkok Airways", "Flight Bangkok–Phuket", 3890.00, "approved", -10, "company_card", None),
]

ANNOUNCEMENTS = [  # org or None for all, title, body, author, pinned, ack, hours_ago
    (None, "Welcome to Wave Team Pro", "This is where we run the group: clock in and out, your tasks, timesheets, leave and expenses, all in one place on your phone or computer. Questions? Ask Priya.", "olivia", True, False, 24 * 20),
    ("uk", "New RAMS template for site work", "From Monday every site visit needs the new RAMS template, which is in Documents → Company → Health & Safety. Please read and confirm.", "marcus", False, True, 30),
    ("sg", "Marina Bay Residences: level 12 handover moved to Friday", "The client has asked for Friday 10:00 instead of Thursday. Ryan's team please plan the snag clearance for Thursday.", "daniel", False, False, 8),
    ("nl", "Sinterklaas lunch on 5 December", "Lunch in the office at 12:30. Bring a surprise with a poem (max €15).", "hannah", False, False, 50),
    ("us", "Thanksgiving schedule", "The office is closed Thursday and Friday. Site work at Miami Beach pauses Wednesday 3 pm.", "michael", False, False, 40),
    ("th", "Office closed for Loy Krathong evening", "We close at 15:00 on Loy Krathong so everyone can get home. Site teams in Phuket finish at 16:00.", "somchai", False, False, 70),
]

CHAT = {  # org: [(author, text, hours_ago)]
    "uk": [("james", "Morning all. Harbourside floor 9 is the priority this week.", 52), ("tom", "On it, van loaded with the APs.", 51), ("liam", "Who has the long ladder? It's not in the store.", 26), ("grace", "I've got it at King's Cross, will bring it over at 4.", 25), ("james", "Great work on floor 8 test results, the client is very happy 👏", 3)],
    "sg": [("daniel", "Reminder: safety briefing at Marina Bay 8:15 tomorrow.", 30), ("nurul", "Noted 👍", 29), ("ryan", "Sentosa zone C covers arriving Thursday.", 5)],
    "nl": [("emma", "LED wall controllers are in the loading bay.", 28), ("daan", "Thanks, we'll take them up after lunch.", 27)],
    "us": [("michael", "Ballroom is dark from 7 pm tonight for the projector work.", 9), ("jessica", "Perfect, I'll do the edge blending then.", 8)],
    "th": [("somchai", "Villa 41–52 IPTV done, good job Kanya!", 6), ("kanya", "ขอบคุณค่ะ! Starting 53 tomorrow.", 5)],
}

BROADCASTS = [  # org, kind, category, title, body, location, start (day_off, hh, mm), end (day_off, hh, mm), tz, attendees, author
    ("sg", "invite", "travel", "Travel: Daniel Koh, Singapore → Bangkok", "Flight SQ 708, Singapore Changi T2 → Bangkok Suvarnabhumi.\nHotel: Sathorn Vista, 3 nights (booking ref SV-48213).\nPurpose: Bangkok office tower screens and Phuket resort review.", "Singapore Changi Airport, Terminal 2", (6, 8, 15), (6, 9, 45), "Asia/Singapore", ["daniel", "somchai"], "priya"),
    ("uk", "invite", "meeting", "Q4 group operations review", "Agenda:\n1. Project pipeline by company\n2. Utilisation and overtime\n3. Hiring plan for Q1\n4. AOB", "London office boardroom + Microsoft Teams", (8, 15, 0), (8, 16, 30), "Europe/London", ["olivia", "marcus", "james", "emma", "daniel", "michael"], "priya"),
    ("uk", "update", "company", "Updated health & safety handbook", "The 2026 health & safety handbook is now in Documents → Company. Main changes: working at height, lone working and van checks. Please read it before your next site visit.", None, None, None, "Europe/London", None, "hannah"),
    ("uk", "update", "project", "Harbourside Hotel: phase 2 starts Monday", "Phase 2 (floors 7–14) starts Monday. Liam's team on floors 7–10, Tom on 11–14. Parking is in the loading bay, entrance B.", None, None, None, "Europe/London", None, "james"),
    ("us", "invite", "travel", "Travel: Jessica Alvarez, Miami → New York", "Flight AA 1442, MIA → LGA.\nPurpose: client demo of the conference AV design.\nReturn the next morning, AA 1517.", "Miami International Airport", (9, 7, 30), (9, 10, 25), "America/New_York", ["jessica", "michael"], "priya"),
]

def money_split(total, vat):
    if not vat:
        return total, 0.0
    sub = round(total / (1 + vat / 100), 2)
    return sub, round(total - sub, 2)

def logo_png(text, sub, bg, fg, w=600, h=160):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 20, 120, 140), radius=28, fill=bg)
    try:
        f1 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 64)
        f2 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
        f3 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 72)
    except OSError:
        f1 = f2 = f3 = ImageFont.load_default()
    d.text((60, 80), text[0], font=f3, fill=(255, 255, 255, 255), anchor="mm")
    d.text((145, 72), text, font=f1, fill=fg, anchor="lm")
    if sub:
        d.text((148, 122), sub, font=f2, fill=(110, 120, 130, 255), anchor="lm")
    buf = io.BytesIO(); img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode(), w, h

out = []
w = out.append
w("-- Wave Team Pro demo data: the fictional Solenne Systems Group. Generated by scripts/demo/build_seed.py.")
w("-- Run ONLY on the empty demo project. Every person, company and email here is invented.")
w(f"-- Demo password for every account: {PASSWORD}")
w("do $seed$")
w("declare")
w("  v_org jsonb := '{}'; v_user jsonb := '{}'; v_mem jsonb := '{}'; v_proj jsonb := '{}'; v_dept jsonb := '{}';")
w("  v_id uuid; v_x uuid; v_conv uuid; v_today date := current_date;")
w("begin")
w("  if exists (select 1 from public.organizations) then")
w("    raise exception 'This database already has companies in it. The demo data only goes into an empty demo database.';")
w("  end if;")
w("  perform set_config('wbh.trusted_op', 'on', true);")

# users
for key, (name, tz, _) in PEOPLE.items():
    email = f"{key}@{DOMAIN}"
    w(f"""  v_id := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', {q(email)}, extensions.crypt({q(PASSWORD)}, extensions.gen_salt('bf')), now(),
    '{{"provider":"email","providers":["email"]}}', jsonb_build_object('display_name', {q(name)}), now() - interval '60 days', now(), '', '', '', '');
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', {q(email)}, 'email_verified', true), 'email', now(), now(), now());
  update public.profiles set timezone = {q(tz)}, display_name = {q(name)} where id = v_id;
  v_user := v_user || jsonb_build_object({q(key)}, v_id);""")
w("  insert into public.platform_admins (user_id) values ((v_user->>'olivia')::uuid);")

for key, name, slug, cur, tz, cc, code, _ in ORGS:
    w(f"""  insert into public.organizations (name, slug, base_currency, timezone, country, legal_entity_code, created_by)
  values ({q(name)}, {q(slug)}, {q(cur)}, {q(tz)}, {q(cc)}, {q(code)}, (v_user->>'olivia')::uuid) returning id into v_id;
  insert into public.organization_settings (organization_id) values (v_id);
  perform public.seed_organization_roles(v_id);
  v_org := v_org || jsonb_build_object({q(key)}, v_id);""")
    for dk, dn in (("ENG", "Projects & Engineering"), ("OPS", "Operations"), ("FIN", "Finance & Admin")):
        w(f"""  insert into public.departments (organization_id, name, code) values (v_id, {q(dn)}, {q(dk)}) returning id into v_x;
  v_dept := v_dept || jsonb_build_object({q(key + dk)}, v_x);""")
    w(f"""  insert into public.leave_types (organization_id, name, color, paid, annual_days, requires_note)
  values (v_id, 'Sick leave', '#c2410c', true, 0, false), (v_id, 'Training', '#2563eb', true, 0, true) on conflict do nothing;""")

# memberships
emp_no = {o: 1 for o in ALL}
order = list(PEOPLE.keys())
for key in order:
    name, tz, mems = PEOPLE[key]
    for org, role, job, dept, field, mgr in mems:
        n = emp_no[org]; emp_no[org] += 1
        w(f"""  insert into public.organization_memberships (organization_id, user_id, job_title, department_id, start_date, employee_number)
  values ((v_org->>{q(org)})::uuid, (v_user->>{q(key)})::uuid, {q(job)}, (v_dept->>{q(org + dept)})::uuid, v_today - {200 + (n * 37) % 900}, {q(f"{org.upper()}-{n:03d}")}) returning id into v_x;
  v_mem := v_mem || jsonb_build_object({q(org + ':' + key)}, v_x);
  insert into public.membership_role_assignments (organization_id, membership_id, role_id, scope_type)
  select (v_org->>{q(org)})::uuid, v_x, r.id, 'organization' from public.roles r where r.organization_id = (v_org->>{q(org)})::uuid and r.key = {q(role)};""")
# managers
for key in order:
    for org, role, job, dept, field, mgr in PEOPLE[key][2]:
        if mgr and any(m[0] == org for m in PEOPLE[mgr][2]):
            w(f"  update public.organization_memberships set manager_membership_id = (v_mem->>{q(org + ':' + mgr)})::uuid where id = (v_mem->>{q(org + ':' + key)})::uuid;")

# teams
for org in ALL:
    w(f"""  insert into public.teams (organization_id, department_id, name, description) values ((v_org->>{q(org)})::uuid, (v_dept->>{q(org + 'ENG')})::uuid, 'Installation crew', 'Field engineers and technicians') returning id into v_x;""")
    for key in order:
        for m in PEOPLE[key][2]:
            if m[0] == org and m[3] == "ENG":
                lead = m[1] in ("team_leader", "project_manager")
                w(f"  insert into public.team_memberships (organization_id, team_id, membership_id, is_lead) values ((v_org->>{q(org)})::uuid, v_x, (v_mem->>{q(org + ':' + key)})::uuid, {str(lead).lower()});")

# projects
for code, (org, name, site, status, s0, e0, hrs, budget, lead, members, desc) in PROJECTS.items():
    cc = ORG[org][5]; cur = ORG[org][3]
    w(f"""  insert into public.projects (organization_id, code, name, description, site_label, status, start_date, end_date, budget_hours, budget_amount, budget_currency, manager_membership_id, country, created_by, team_id)
  values ((v_org->>{q(org)})::uuid, {q(code)}, {q(name)}, {q(desc)}, {q(site)}, {q(status)}, v_today + {s0}, v_today + {e0}, {hrs}, {budget}, {q(cur)},
    (v_mem->>{q(org + ':' + lead)})::uuid, {q(cc)}, (v_user->>'olivia')::uuid,
    (select id from public.teams where organization_id = (v_org->>{q(org)})::uuid limit 1)) returning id into v_x;
  v_proj := v_proj || jsonb_build_object({q(code)}, v_x);
  insert into demo.story values ('projects', v_x);
  insert into public.project_members (project_id, organization_id, membership_id, role) values (v_x, (v_org->>{q(org)})::uuid, (v_mem->>{q(org + ':' + lead)})::uuid, 'lead');""")
    for m in members:
        if (org + ":" + m) not in [o + ":" + k for k in PEOPLE for (o, *_r) in PEOPLE[k][2]]:
            continue
        w(f"  insert into public.project_members (project_id, organization_id, membership_id, role) values (v_x, (v_org->>{q(org)})::uuid, (v_mem->>{q(org + ':' + m)})::uuid, 'member');")
    # directors and PMs who oversee
# Daniel oversees Thai projects
for code in ("PVR", "BOT"):
    w(f"  insert into public.project_members (project_id, organization_id, membership_id, role) values ((v_proj->>{q(code)})::uuid, (v_org->>'th')::uuid, (v_mem->>'th:daniel')::uuid, 'lead');")
# assigned projects for clock-in
for key in order:
    for org, role, job, dept, field, mgr in PEOPLE[key][2]:
        if field:
            w(f"  update public.organization_memberships set assigned_project_id = (v_proj->>{q(field)})::uuid where id = (v_mem->>{q(org + ':' + key)})::uuid;")

def org_of_person(key, prefer=None):
    orgs = [m[0] for m in PEOPLE[key][2]]
    return prefer if prefer in orgs else orgs[0]

# tasks
for i, (proj, title, desc, status, prio, due, assignees, creator, outcome, onote, checklist, comments) in enumerate(TASKS):
    org = PROJECTS[proj][0] if proj else TASK_ORG[None]
    pexpr = f"(v_proj->>{q(proj)})::uuid" if proj else "null"
    done_expr = "now() - interval '%d hours'" % (24 * max(1, -due) if due < 0 else 1)
    w(f"""  insert into public.tasks (organization_id, project_id, title, description, status, priority, due_date, created_by, position, created_at, completed_at, outcome, outcome_note, outcome_by, outcome_at)
  values ((v_org->>{q(org)})::uuid, {pexpr}, {q(title)}, {q(desc)}, {q(status)}, {q(prio)}, v_today + {due}, (v_user->>{q(creator)})::uuid, {i},
    now() - interval '{6 + i % 9} days', {done_expr if status == 'done' else 'null'}, {q(outcome)}, {q(onote)},
    {"(v_user->>" + q(assignees[0]) + ")::uuid" if outcome else "null"}, {done_expr if outcome else "null"}) returning id into v_x;
  insert into demo.story values ('tasks', v_x);""")
    for a in assignees:
        w(f"  insert into public.task_assignees (task_id, organization_id, user_id, assigned_by) values (v_x, (v_org->>{q(org)})::uuid, (v_user->>{q(a)})::uuid, (v_user->>{q(creator)})::uuid);")
    for j, (t, dn) in enumerate(checklist):
        w(f"  insert into public.task_checklist_items (task_id, title, done, position) values (v_x, {q(t)}, {str(dn).lower()}, {j});")
    for (author, text, ago) in comments:
        w(f"""  insert into public.task_comments (task_id, organization_id, author_id, body, created_at) values (v_x, (v_org->>{q(org)})::uuid, (v_user->>{q(author)})::uuid, {q(text)}, now() - interval '{ago} hours') returning id into v_id;
  insert into demo.story values ('task_comments', v_id);""")
for i, (who, proj, title, desc, status, prio, due) in enumerate(OWN_TASKS):
    org = PROJECTS[proj][0] if proj else org_of_person(who)
    pexpr = f"(v_proj->>{q(proj)})::uuid" if proj else "null"
    w(f"""  insert into public.tasks (organization_id, project_id, title, description, status, priority, due_date, created_by, position, created_at, completed_at)
  values ((v_org->>{q(org)})::uuid, {pexpr}, {q(title)}, {q(desc)}, {q(status)}, {q(prio)}, v_today + {due}, (v_user->>{q(who)})::uuid, {100 + i}, now() - interval '{2 + i % 5} days', {"now() - interval '20 hours'" if status == 'done' else 'null'}) returning id into v_x;
  insert into demo.story values ('tasks', v_x);
  insert into public.task_assignees (task_id, organization_id, user_id, assigned_by) values (v_x, (v_org->>{q(org)})::uuid, (v_user->>{q(who)})::uuid, (v_user->>{q(who)})::uuid);""")

# leave
for who, org, s0, e0, status, note, reviewer in LEAVE:
    days = 0
    import datetime
    w(f"""  insert into public.leave_requests (organization_id, membership_id, leave_type_id, start_date, end_date, days, status, reviewed_by, reviewed_at, created_at)
  select (v_org->>{q(org)})::uuid, (v_mem->>{q(org + ':' + who)})::uuid, lt.id, v_today + {s0}, v_today + {e0},
    (select count(*) from generate_series(v_today + {s0}, v_today + {e0}, interval '1 day') g where extract(isodow from g) < 6),
    {q(status)}, {"(v_user->>" + q(reviewer) + ")::uuid" if reviewer else "null"}, {"now() - interval '3 days'" if reviewer else "null"}, now() - interval '6 days'
  from public.leave_types lt where lt.organization_id = (v_org->>{q(org)})::uuid and lt.name = 'Annual leave' returning id into v_x;
  insert into demo.story values ('leave_requests', v_x);""")
    if note:
        w(f"  insert into public.leave_request_reasons (request_id, reason) values (v_x, {q(note)});")
    if status == "rejected":
        w("  update public.leave_requests set review_note = 'We need everyone on site that day for the client handover, sorry. Could you take the following Monday?' where id = v_x;")

# expenses
REVIEWER = {"uk": "sarah", "nl": "sarah", "us": "sarah", "sg": "weiling", "th": "weiling"}
for who, org, proj, cat, merchant, desc, total, status, day, pay, reimb in EXPENSES:
    vat = ORG[org][7]; cur = ORG[org][3]
    sub, tax = money_split(total, vat)
    rv = REVIEWER[org]
    reviewed = status in ("approved", "rejected")
    reimbursable = pay == "personal"
    rstatus = "not_required" if not reimbursable else ("paid" if reimb == "paid" else "pending")
    w(f"""  insert into public.expenses (organization_id, membership_id, project_id, category_id, status, expense_date, merchant, description, currency, subtotal, tax_amount, total,
    payment_method, reimbursable, reporting_currency, fx_rate, fx_date, fx_source, reporting_total, extraction_status, submitted_at, reviewed_by, reviewed_at, review_note,
    reimbursement_status, reimbursed_at, reimbursed_by, reimbursement_reference, created_by, created_at, no_receipt_reason)
  select (v_org->>{q(org)})::uuid, (v_mem->>{q(org + ':' + who)})::uuid, (v_proj->>{q(proj)})::uuid, c.id, {q(status)}, v_today + {day}, {q(merchant)}, {q(desc)}, {q(cur)}, {sub}, {tax}, {total},
    {q(pay)}, {str(reimbursable).lower()}, {q(cur)}, 1, v_today + {day}, 'same_currency', {total}, 'none',
    {"now() + interval '%d days'" % day if status != 'draft' else 'null'}, {"(v_user->>" + q(rv) + ")::uuid" if reviewed else 'null'}, {"now() + interval '%d days' + interval '5 hours'" % day if reviewed else 'null'},
    {q("Meals on site are covered by the daily site allowance, so this can't be claimed separately.") if status == 'rejected' else 'null'},
    {q(rstatus if status == 'approved' else ('pending' if reimbursable and status == 'submitted' else 'not_required'))},
    {"now() + interval '%d days' + interval '2 days'" % day if reimb == 'paid' else 'null'}, {"(v_user->>" + q(rv) + ")::uuid" if reimb == 'paid' else 'null'}, {q('BACS ' + str(4100 + int(total)) ) if reimb == 'paid' else 'null'},
    (v_user->>{q(who)})::uuid, now() + interval '{day} days', 'Paper receipt handed in at the office'
  from public.expense_categories c where c.organization_id = (v_org->>{q(org)})::uuid and c.name = {q(cat)} returning id into v_x;
  insert into demo.story values ('expenses', v_x);""")

# announcements
for org, title, body, author, pinned, ack, ago in ANNOUNCEMENTS:
    for o in (ALL if org is None else [org]):
        if not any(m[0] == o for m in PEOPLE[author][2]):
            continue
        w(f"""  insert into public.announcements (organization_id, title, body, audience, requires_ack, pinned, published_by, published_at)
  values ((v_org->>{q(o)})::uuid, {q(title)}, {q(body)}, 'organization', {str(ack).lower()}, {str(pinned).lower()}, (v_user->>{q(author)})::uuid, now() - interval '{ago} hours') returning id into v_x;
  insert into demo.story values ('announcements', v_x);""")

# chat in each company's general channel
for org, msgs in CHAT.items():
    w(f"  select id into v_conv from public.conversations where organization_id = (v_org->>{q(org)})::uuid and type = 'channel' order by created_at limit 1;")
    w("  insert into demo.story values ('conversations', v_conv);")
    for author, text, ago in msgs:
        w(f"""  insert into public.messages (organization_id, conversation_id, author_id, body, created_at) values ((v_org->>{q(org)})::uuid, v_conv, (v_user->>{q(author)})::uuid, {q(text)}, now() - interval '{ago} hours') returning id into v_x;
  insert into demo.story values ('messages', v_x);""")
    w("  update public.conversations set last_message_at = now() - interval '3 hours' where id = v_conv;")

# company communications
for org, kind, cat, title, body, loc, s, e, tz, att, author in BROADCASTS:
    if s:
        st = f"demo.at(v_today + {s[0]}, {s[1] * 60 + s[2]}, {q(tz)})"; en = f"demo.at(v_today + {e[0]}, {e[1] * 60 + e[2]}, {q(tz)})"
    else:
        st = en = "null"
    ids = "array[" + ",".join(f"(v_user->>{q(a)})::uuid" for a in (att or [])) + "]::uuid[]"
    emails = "array[" + ",".join(q(f"{a}@{DOMAIN}") for a in (att or [])) + "]::text[]"
    audience = "Everyone at " + ORG[org][1] if not att else None
    if not att:
        ids = "'{}'::uuid[]"
        emails = f"(select array_agg(u.email::text) from auth.users u join public.organization_memberships m on m.user_id = u.id where m.organization_id = (v_org->>{q(org)})::uuid)"
    w(f"""  insert into public.calendar_broadcasts (organization_id, kind, category, title, body, location, starts_at, ends_at, time_zone, audience, attendee_emails, attendee_user_ids, created_by, created_at)
  values ((v_org->>{q(org)})::uuid, {q(kind)}, {q(cat)}, {q(title)}, {q(body)}, {q(loc)}, {st}, {en}, {q(tz)}, {q(audience)}, {emails}, {ids}, (v_user->>{q(author)})::uuid, now() - interval '{4 + len(title) % 20} hours') returning id into v_x;
  insert into demo.story values ('calendar_broadcasts', v_x);""")

# public holidays (a few upcoming)
HOL = {"uk": [(51, "Christmas Day"), (52, "Boxing Day")], "nl": [(51, "Eerste Kerstdag"), (52, "Tweede Kerstdag")], "sg": [(51, "Christmas Day")], "us": [(22, "Thanksgiving Day"), (51, "Christmas Day")], "th": [(33, "King Bhumibol's Birthday")]}
for org, hs in HOL.items():
    for off, name in hs:
        w(f"  insert into public.public_holidays (organization_id, holiday_date, name) values ((v_org->>{q(org)})::uuid, v_today + {off}, {q(name)}) on conflict do nothing;")

# simulated workers
for key in order:
    name, tz, mems = PEOPLE[key]
    for org, role, job, dept, field, mgr in mems:
        if not field:
            continue
        reviewer = mgr if mgr and any(m[0] == org for m in PEOPLE[mgr][2]) else "olivia"
        h = sum(map(ord, key))
        in_min = 7 * 60 + 30 + h % 30
        out_min = 16 * 60 + 30 + h % 45 if key not in ("nurul", "chris") else 15 * 60 + 30
        site = PROJECTS[field][2]
        w(f"""  insert into demo.workers values ((v_mem->>{q(org + ':' + key)})::uuid, (v_org->>{q(org)})::uuid, (v_user->>{q(key)})::uuid, {q(ORG[org][4])},
    (v_proj->>{q(field)})::uuid, (v_user->>{q(reviewer)})::uuid, {q(site)}, {in_min}, {out_min}, 30);""")

# branding
pl, pw, ph = logo_png("Wave Team Pro", "Every company. One team.", (37, 99, 235, 255), (15, 23, 42, 255))
w(f"  insert into public.platform_branding (logo_png_base64, logo_width, logo_height) values ({q(pl)}, {pw}, {ph}) on conflict (id) do update set logo_png_base64 = excluded.logo_png_base64, logo_width = excluded.logo_width, logo_height = excluded.logo_height;")
for key, name, *_ in ORGS:
    cl, cw, ch = logo_png("Solenne", {"uk": "Systems Ltd · London", "nl": "Systems BV · Amsterdam", "sg": "Systems Pte Ltd · Singapore", "us": "Systems Inc · Miami", "th": "Systems Co Ltd · Bangkok"}[key], (13, 148, 136, 255), (15, 23, 42, 255))
    w(f"  insert into public.organization_branding (organization_id, logo_png_base64, logo_width, logo_height) values ((v_org->>{q(key)})::uuid, {q(cl)}, {cw}, {ch});")

w("  insert into demo.state (anchor, started) values (v_today, (v_today - 21) - (extract(isodow from v_today - 21)::int - 1));")
w("  insert into demo.story select 'notifications', id from public.notifications;")
w("  perform set_config('wbh.trusted_op', 'off', true);")
w("end $seed$;")
w("select demo.refresh();")

(ROOT / "supabase/demo/02_seed.sql").write_text("\n".join(out) + "\n")
print("ok", len("\n".join(out)))
