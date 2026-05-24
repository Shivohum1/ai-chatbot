import os
from dotenv import load_dotenv
from arize.otel import register
from openinference.instrumentation.openai import OpenAIInstrumentor

load_dotenv()

print("🔧 Setting up Arize telemetry...")

SPACE_ID = os.getenv("ARIZE_SPACE_ID")
API_KEY = os.getenv("ARIZE_API_KEY")

print(f"Space ID: {SPACE_ID}")
print(f"API Key: {API_KEY[:10]}..." if API_KEY else "API Key: None")

tracer_provider = register(
    space_id=SPACE_ID,
    api_key=API_KEY,
    project_name="production-chatbot",
    set_global_tracer_provider=True,
)

print("✅ Tracer provider registered")

OpenAIInstrumentor().instrument(
    tracer_provider=tracer_provider
)

print("✅ OpenAI instrumentation complete")
