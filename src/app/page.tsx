"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://paggxsvqosfduuqlgydl.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_HdrCoyome63dHoq-_Q_khw_reIHm...";
const supabase = createClient(supabaseUrl, supabaseKey);

export default function Home() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLeads() {
      try {
        const { data, error } = await supabase
          .from("bizmap_leads")
          .select("*")
          .limit(100);
        
        if (error) throw error;
        setLeads(data || []);
      } catch (err: any) {
        console.error("Error fetching bizmap leads:", err.message);
        setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchLeads();
  }, []);

  return (
    <main className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Auralink Digital CRM Pipeline</h1>
        <span className="bg-blue-100 text-blue-800 text-sm font-semibold px-3 py-1 rounded-full">
          {leads.length} leads loaded
        </span>
      </div>
      
      {errorMessage && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          <strong>Database Error:</strong> {errorMessage}
        </div>
      )}

      {loading ? (
        <p className="text-gray-600">Loading full database pipeline...</p>
      ) : (
        <div className="bg-white shadow-md rounded-lg overflow-hidden border border-gray-200">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-200 text-gray-700">
                <th className="p-4 font-semibold">Business Name</th>
                <th className="p-4 font-semibold">Type</th>
                <th className="p-4 font-semibold">ID / Record</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-gray-500">No records found in bizmap_leads.</td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="p-4 font-medium text-gray-900">{lead.business_name || "Unnamed"}</td>
                    <td className="p-4 text-blue-600 font-semibold">{lead.business_type || "N/A"}</td>
                    <td className="p-4 text-gray-500 text-xs font-mono">{lead.id}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
