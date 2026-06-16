import os
import requests
from pprint import pprint
from dotenv import load_dotenv

# =========================================================
# LOAD ENV VARIABLES
# =========================================================

load_dotenv()

ARIZE_API_KEY = os.getenv("ARIZE_API_KEY")
SPACE_ID = os.getenv("ARIZE_SPACE_ID")
AI_INTEGRATION_ID = os.getenv("AI_INTEGRATION_ID")

BASE_URL = "https://api.arize.com/v2"

# =========================================================
# VALIDATE ENV VARIABLES
# =========================================================

if not ARIZE_API_KEY:
    raise ValueError("Missing ARIZE_API_KEY in .env")

if not SPACE_ID:
    raise ValueError("Missing ARIZE_SPACE_ID in .env")

if not AI_INTEGRATION_ID:
    raise ValueError("Missing AI_INTEGRATION_ID in .env")

# Remove accidental spaces/newlines
ARIZE_API_KEY = ARIZE_API_KEY.strip()
SPACE_ID = SPACE_ID.strip()
AI_INTEGRATION_ID = AI_INTEGRATION_ID.strip()

# Remove accidental "Bearer "
if ARIZE_API_KEY.startswith("Bearer "):
    ARIZE_API_KEY = ARIZE_API_KEY.replace("Bearer ", "")

# =========================================================
# HEADERS
# =========================================================

HEADERS = {
    "Authorization": f"Bearer {ARIZE_API_KEY}",
    "Content-Type": "application/json",
}

# =========================================================
# DEBUG PRINTS
# =========================================================

print("\n================ ENV CHECK ================\n")

print("API KEY FOUND:", bool(ARIZE_API_KEY))
print("SPACE ID:", SPACE_ID)
print("AI INTEGRATION ID:", AI_INTEGRATION_ID)

# =========================================================
# TEST AUTH
# =========================================================

print("\n================ TEST AUTH ================\n")

auth_response = requests.get(
    f"{BASE_URL}/projects",
    headers=HEADERS
)

print("STATUS:", auth_response.status_code)

if auth_response.status_code == 401:
    print("\nAUTH FAILED")
    pprint(auth_response.json())
    exit()

print("AUTH SUCCESSFUL")

# =========================================================
# 1. CREATE PROJECT
# =========================================================

print("\n================ CREATE PROJECT ================\n")

project_payload = {
    "name": "project-created-through-restapi",
    "space_id": SPACE_ID
}

project_response = requests.post(
    f"{BASE_URL}/projects",
    headers=HEADERS,
    json=project_payload
)

print("STATUS:", project_response.status_code)

try:
    project_json = project_response.json()
    pprint(project_json)
except Exception:
    print(project_response.text)

# Save project ID if created
PROJECT_ID = None

if project_response.status_code in [200, 201]:
    PROJECT_ID = project_json.get("id")

# =========================================================
# 2. LIST PROJECTS
# =========================================================

print("\n================ LIST PROJECTS ================\n")

projects_response = requests.get(
    f"{BASE_URL}/projects",
    headers=HEADERS,
    params={
        "space_id": SPACE_ID,
        "limit": 20
    }
)

print("STATUS:", projects_response.status_code)

try:
    projects_json = projects_response.json()
    pprint(projects_json)
except Exception:
    print(projects_response.text)

# =========================================================
# 3. LIST EVALUATORS
# =========================================================

print("\n================ LIST EVALUATORS ================\n")

evals_response = requests.get(
    f"{BASE_URL}/evaluators",
    headers=HEADERS,
    params={
        "space_id": SPACE_ID,
        "limit": 20
    }
)

print("STATUS:", evals_response.status_code)

try:
    evals_json = evals_response.json()
    pprint(evals_json)
except Exception:
    print(evals_response.text)

# =========================================================
# 4. CREATE TEMPLATE EVALUATOR
# =========================================================

print("\n================ CREATE EVALUATOR ================\n")

evaluator_payload = {
    "space_id": SPACE_ID,
    "name": "Hallucination Detector Demo",
    "description": "Detect hallucinated responses",
    "type": "template",
    "version": {
        "commit_message": "Initial version",
        "template_config": {
            "name": "hallucination_eval",
            "template": """
You are an expert evaluator.

Question:
{input}

LLM Response:
{output}

Determine whether the response contains hallucinated information.

Return one of:
- factual
- hallucinated
""",
            "include_explanations": True,
            "use_function_calling_if_available": True,
            "classification_choices": {
                "hallucinated": 0,
                "factual": 1
            },
            "direction": "maximize",
            "data_granularity": "span",
            "llm_config": {
                "ai_integration_id": AI_INTEGRATION_ID,
                "model_name": "gpt-4o",
                "invocation_parameters": {
                    "temperature": 0
                },
                "provider_parameters": {}
            }
        }
    }
}

create_eval_response = requests.post(
    f"{BASE_URL}/evaluators",
    headers=HEADERS,
    json=evaluator_payload
)

print("STATUS:", create_eval_response.status_code)

try:
    eval_json = create_eval_response.json()
    pprint(eval_json)
except Exception:
    print(create_eval_response.text)

# =========================================================
# SUMMARY
# =========================================================

print("\n================ SUMMARY ================\n")

print("Projects List Status:", projects_response.status_code)
print("Evaluators List Status:", evals_response.status_code)
print("Create Evaluator Status:", create_eval_response.status_code)

if PROJECT_ID:
    print("Created Project ID:", PROJECT_ID)