import React, { useState } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Activity, MessageSquare, UploadCloud, BarChart2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function App() {
  const [data, setData] = useState([]);
  const [fileStatus, setFileStatus] = useState('No file uploaded yet.');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([
    { role: 'ai', text: 'Upload a network log CSV to begin analysis.' }
  ]);
  const [loading, setLoading] = useState(false);
  
  // NEW: State to track which columns the AI wants to display
  const [visibleColumns, setVisibleColumns] = useState([]);
  const colors = ["#60A5FA", "#F87171", "#34D399", "#FBBF24", "#A78BFA"];

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    setFileStatus(`Uploading ${file.name}...`);

    try {
      await axios.post('http://localhost:8000/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setFileStatus(`${file.name} loaded successfully.`);
      
      const res = await axios.get('http://localhost:8000/api/telemetry');
      setData(res.data);
      
      // Auto-detect numeric columns from the new dataset and plot the first two by default
      if (res.data.length > 0) {
        const firstRow = res.data[0];
        const numericCols = Object.keys(firstRow).filter(k => k !== 'timestamp' && typeof firstRow[k] === 'number');
        setVisibleColumns(numericCols.slice(0, 2));
      }

      setChatHistory(prev => [...prev, { role: 'ai', text: 'Data loaded. What would you like to know about this network log?' }]);
    } catch (err) {
      setFileStatus(`Error uploading file: ${err.message}`);
    }
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput || data.length === 0) return;

    const userMessage = { role: 'user', text: chatInput };
    setChatHistory([...chatHistory, userMessage]);
    setChatInput('');
    setLoading(true);

    try {
      const response = await axios.post('http://localhost:8000/api/chat', { query: userMessage.text });
      let aiText = response.data.response;

      // NEW: Intercept AI Action Tags for Graph Control
      // Looks for text like [PLOT: latency_ms, rsrp_dbm]
      const plotMatch = aiText.match(/\[PLOT:\s*(.+?)\]/i);
      if (plotMatch) {
        const cols = plotMatch[1].split(',').map(c => c.trim());
        setVisibleColumns(cols); // Command the chart to update
        aiText = aiText.replace(plotMatch[0], '').trim(); // Remove the tag so the user doesn't see it
      }

      setChatHistory(prev => [...prev, { role: 'ai', text: aiText }]);
    } catch (error) {
      setChatHistory(prev => [...prev, { role: 'ai', text: 'Error contacting AI agent. Is the backend running?' }]);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 font-sans">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="text-blue-400" size={32} />
          <h1 className="text-3xl font-bold">NetResolve AI</h1>
        </div>
        
        <div className="flex items-center gap-4 bg-gray-800 p-2 rounded-lg border border-gray-700">
          <span className="text-sm text-gray-400">{fileStatus}</span>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md flex items-center gap-2 transition-colors">
            <UploadCloud size={18} />
            <span>Upload CSV</span>
            <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg lg:sticky lg:top-8 self-start">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-200">Network Telemetry Viewer</h2>
            <div className="flex gap-2 text-xs text-gray-400">
              <BarChart2 size={16}/> Dynamic Layout
            </div>
          </div>
          
          {data.length > 0 ? (
            <div className="h-80 w-full text-sm">
              <ResponsiveContainer>
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="timestamp" stroke="#9CA3AF" tick={{fontSize: 10}} tickFormatter={(tick) => tick ? String(tick).substring(11,16) : ''} />
                  
                  {/* Dynamic dual axes to handle different data scales (e.g. percentages vs negative dBm) */}
                  <YAxis yAxisId="left" stroke="#9CA3AF" />
                  {visibleColumns.length > 1 && <YAxis yAxisId="right" orientation="right" stroke="#9CA3AF" />}
                  
                  <Tooltip contentStyle={{backgroundColor: '#1F2937', border: 'none'}} />
                  <Legend />
                  
                  {/* Generate lines dynamically based on AI's command */}
                  {visibleColumns.map((col, idx) => (
                    <Line 
                      key={col} 
                      yAxisId={idx % 2 === 0 ? "left" : "right"} 
                      type="monotone" 
                      dataKey={col} 
                      stroke={colors[idx % colors.length]} 
                      dot={false} 
                      name={col} 
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80 flex items-center justify-center text-gray-500 border-2 border-dashed border-gray-700 rounded-lg">
              Upload a network log file to visualize data.
            </div>
          )}
        </div>

        {/* ... (The Chat Window section remains identical) ... */}
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg flex flex-col h-[600px] lg:h-[calc(100vh-140px)]">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><MessageSquare size={20}/> Diagnostic Agent</h2>
          
          <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2">
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`p-4 rounded-lg text-sm max-w-[90%] ${msg.role === 'user' ? 'bg-blue-600 ml-auto text-white' : 'bg-gray-700 text-gray-200'}`}>
                {msg.role === 'user' ? (
                  msg.text
                ) : (
                  <div className="prose prose-invert max-w-none prose-sm prose-td:border prose-td:border-gray-600 prose-th:border prose-th:border-gray-500 prose-th:bg-gray-800 prose-table:w-full prose-table:border-collapse">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
            {loading && <div className="text-gray-400 animate-pulse text-sm">Agent executing logic...</div>}
          </div>

          <form onSubmit={handleChatSubmit} className="flex gap-2">
            <input 
              type="text" 
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={data.length === 0}
              placeholder={data.length === 0 ? "Upload data first..." : "e.g., At what time did the signal drop lowest?"} 
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-400 disabled:opacity-50"
            />
            <button type="submit" disabled={data.length === 0} className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
              Ask
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}