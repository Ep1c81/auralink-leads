"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://paggxsvqosfduuqlgydl.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZ2d4c3Zxb3NmZHV1cWxneWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyMzUxNDQsImV4cCI6MjA1NjgxMTE0NH0.eyJJw3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZ2d4c3Zxb3NmZHV1cWxneWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyMzUxNDQsImV4cCI6MjA1NjgxMTE0NH0";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default function LeadDashboard() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    async function fetchLeads() {
      try {
        const { data, error } = await supabase
          .from("bizmap_leads")
          .select("*")
          .limit(100);
        
        if (error) throw error;
        setLeads(data || []);
      } catch (err) {
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
      <h1 className="text-3xl font-bold mb-6 text-gray-900">Auralink Digital CRM Pipeline</h1>
      
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
                  <td colSpan="3" className="p-6 text-center text-gray-500">No records found in bizmap_leads.</td>
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
