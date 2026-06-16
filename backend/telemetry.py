import os
from dotenv import load_dotenv
from arize.otel import register
from openinference.instrumentation.openai import OpenAIInstrumentor

load_dotenv()

SPACE_ID = os.getenv("ARIZE_SPACE_ID")
API_KEY = os.getenv("ARIZE_API_KEY")

if SPACE_ID and API_KEY:
    try:
        print("Setting up Arize telemetry...")
        tracer_provider = register(
            space_id=SPACE_ID,
            api_key=API_KEY,
            project_name="production-chatbot",
            set_global_tracer_provider=True,
        )
        OpenAIInstrumentor().instrument(
            tracer_provider=tracer_provider
        )
        print("Arize telemetry enabled.")
    except Exception as exc:
        # Telemetry should never block API startup.
        print(f"Arize telemetry disabled: {exc}")
else:
    print("Arize telemetry not configured; continuing without tracing.")
