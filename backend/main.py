from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import io
import os
import io as python_io
import sys
from contextlib import redirect_stdout
from fastapi import Response
# LangGraph and LangChain imports
from typing import Annotated
from typing_extensions import TypedDict 
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv

# 1. Load Environment Variables & Initialize Groq LLM
load_dotenv()

try:
    llm = ChatOpenAI(
        api_key=os.getenv("GROQ_API_KEY"),
        base_url="https://api.groq.com/openai/v1",
        model="openai/gpt-oss-20b", # Using a powerful Groq model for tool calling
        temperature=0.2
    )
except Exception as e:
    print(f"Error initializing LLM: {e}. Check GROQ_API_KEY in your .env file.")

# 2. Global State for the DataFrame
uploaded_df = pd.DataFrame()

# 3. Define the Tool for the LLM
@tool
def execute_pandas_code(code: str) -> str:
    """
    Executes Python pandas code on the global dataframe named 'df'.
    Always use 'df' to refer to the data. Print the result you want to return.
    Example code: "print(df['latency_ms'].mean())"
    """
    global uploaded_df
    if uploaded_df.empty:
        return "Error: No dataframe uploaded."
    
    # Capture standard output to return the result of the print statements
    f = python_io.StringIO()
    with redirect_stdout(f):
        try:
            # Provide the global uploaded_df as 'df' to the execution environment
            exec_globals = {"pd": pd, "df": uploaded_df}
            exec(code, exec_globals)
        except Exception as e:
            return f"Execution Error: {str(e)}"
    
    output = f.getvalue()
    return output if output else "Code executed successfully but printed nothing."

tools = [execute_pandas_code]
llm_with_tools = llm.bind_tools(tools)

# 4. Define the LangGraph State and Nodes
class State(TypedDict):
    messages: Annotated[list, add_messages]

def tool_calling_llm(state: State):
    return {"messages": [llm_with_tools.invoke(state["messages"])]}

# 5. Build and Compile the LangGraph
builder = StateGraph(State)
builder.add_node("tool_calling_llm", tool_calling_llm)
builder.add_node("tools", ToolNode(tools))

builder.add_edge(START, "tool_calling_llm")
builder.add_conditional_edges("tool_calling_llm", tools_condition)
builder.add_edge("tools", "tool_calling_llm") # Loop back to LLM after tool execution

graph = builder.compile()

app = FastAPI(title="NetResolve AI - Groq LangGraph API")

# Ensure this block is placed exactly here, BEFORE your routes (@app.post, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],           # Allows all origins
    allow_credentials=True,        # Required for some browser requests
    allow_methods=["*"],           # Allows all methods (GET, POST, OPTIONS, etc.)
    allow_headers=["*"],           # Allows all headers
    expose_headers=["*"]           # Ensures the browser can read the response headers
)
class ChatRequest(BaseModel):
    query: str

@app.post("/api/upload")
async def upload_telemetry(file: UploadFile = File(...)):
    """Accepts a CSV upload and loads it into memory."""
    global uploaded_df
    try:
        contents = await file.read()
        uploaded_df = pd.read_csv(io.StringIO(contents.decode('utf-8')))
        return {"message": f"Successfully loaded {file.filename}", "rows": len(uploaded_df)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {str(e)}")

@app.get("/api/telemetry")
def get_telemetry():
    global uploaded_df
    if uploaded_df.empty:
        return []
        
    # to_json() automatically and safely converts NaN to JSON nulls
    return Response(
        content=uploaded_df.to_json(orient="records"),
        media_type="application/json"
    )

@app.post("/api/chat")
def analyze_network(request: ChatRequest):
    """LangGraph endpoint where Groq queries the dataframe via tools."""
    global uploaded_df
    if uploaded_df.empty:
        raise HTTPException(status_code=400, detail="Please upload a log file first.")

    system_prompt = SystemMessage(content=(
        "You are a Senior Telecommunications Engineer at Qualcomm. "
        "You have access to a tool that executes pandas code on a dataframe named 'df'. "
        f"The dataframe has the following columns: {list(uploaded_df.columns)}. "
        "To answer the user's query, write python code to analyze the data, "
        "look at the tool's output, and then explain the results.\n\n"
        "*** CRITICAL DASHBOARD CONTROL INSTRUCTIONS ***\n"
        "You have the ability to dynamically update the user's UI graph to show the exact metrics you are talking about. "
        "If your analysis focuses on specific columns, you MUST include this exact tag anywhere in your text response: "
        "[PLOT: column_name_1, column_name_2]\n"
        "For example, if the user asks about signal and latency, include: [PLOT: rsrp_dbm, latency_ms]\n"
        "Only plot numeric columns that actually exist in the dataframe."
    ))
    
    user_prompt = HumanMessage(content=request.query)
    
    try:
        # Invoke the LangGraph workflow
        initial_state = {"messages": [system_prompt, user_prompt]}
        final_state = graph.invoke(initial_state)
        
        # The final message in the state is the LLM's final answer
        final_message = final_state["messages"][-1].content
        return {"response": final_message}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)