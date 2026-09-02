\"use client\";
import { useState, useEffect } from \"react\";
import { createClient } from \"@supabase/supabase-js\";

const SUPABASE_URL = \"https://paggxsvqosfduuqlgydl.supabase.co\";
const SUPABASE_KEY = \"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZ2d4c3Zxb3NmZHV1cWxneWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNDcwNTAsImV4cCI6MjEwMjkyMzA1MH0.G9cmY4_dFX7ab6cOgYdlWnvRBbVHL4KK6IEccCpRTac\";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default function LeadDashboard() {
  const [leads, setLeads] = useState([]);
  const [filter, setFilter] = useState(\"Hot Lead\");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeads();
  }, [filter]);

  async function fetchLeads() {
    setLoading(true);
    let query = supabase.table(\"bizmap_leads\").select(\"*\").order(\"lead_score\", { ascending: false }).limit(50);
    
    if (filter !== \"All\") {
      query = query.eq(\"status\", filter);
    }
    
    const { data, error } = await query;
    if (!error) setLeads(data || []);
    setLoading(false);
  }

  const copyPitch = (lead) => {
    const biz = lead.business_name || \"Local Business\";
    const type = lead.business_type || \"establishment\";
    const notes = lead.ai_notes || \"\";
    
    let pitch = notes.includes(\"Missing digital web presence\")
      ? `Hola team at ${biz}! Noticed your ${type} is killing it locally, but you don't have a dedicated web presence yet. At Auralinkdigital.com, we build high-converting web apps that capture local traffic.`
      : `Hola team at ${biz}! Love what you're doing. With high foot-traffic in your niche, we help spots like yours double 5-star Google reviews automatically using smart NFC standees. Let's connect!`;

    navigator.clipboard.writeText(pitch);
    alert(`Pitch copied for ${biz}!`);
  };

  return (
    <div className=\"min-h-screen bg-gray-950 text-white p-8\">
      <div className=\"max-w-6xl mx-auto\">
        <header className=\"flex justify-between items-center mb-8 border-b border-gray-800 pb-4\">
          <div>
            <h1 className=\"text-3xl font-bold tracking-tight text-emerald-400\">Auralink Digital CRM</h1>
            <p className=\"text-gray-400 text-sm\">Automated Local Lead Intelligence & Pipeline</p>
          </div>
          <div className=\"flex gap-2\">
            {[\"Hot Lead\", \"Standard Lead\", \"All\"].map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  filter === tab ? \"bg-emerald-600 text-white\" : \"bg-gray-800 text-gray-300 hover:bg-gray-700\"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </header>

        {loading ? (
          <div className=\"text-center py-20 text-gray-400\">Loading prospects from Supabase...</div>
        ) : (
          <div className=\"grid grid-cols-1 md:grid-cols-2 gap-4\">
            {leads.map((lead) => (
              <div key={lead.id} className=\"bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col justify-between shadow-lg\">
                <div>
                  <div className=\"flex justify-between items-start mb-2\">
                    <h3 className=\"text-lg font-semibold text-white\">{lead.business_name}</h3>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      lead.lead_score >= 8 ? \"bg-emerald-950 text-emerald-400 border border-emerald-800\" : \"bg-gray-800 text-gray-300\"
                    }`}>
                      Score: {lead.lead_score}/10
                    </span>
                  </div>
                  <p className=\"text-xs text-emerald-500 uppercase tracking-wider mb-3\">{lead.business_type}</p>
                  <p className=\"text-sm text-gray-300 bg-gray-950/50 p-3 rounded-lg border border-gray-800/60 mb-4\">
                    {lead.ai_notes || \"Evaluated standard lead.\"}
                  </p>
                </div>
                <div className=\"flex justify-between items-center pt-3 border-t border-gray-800 text-xs text-gray-400\">
                  <span>Status: <strong className=\"text-white\">{lead.status}</strong></span>
                  <button
                    onClick={() => copyPitch(lead)}
                    className=\"bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-md font-medium transition shadow\"
                  >
                    Copy AI Pitch
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
