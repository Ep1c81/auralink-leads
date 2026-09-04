"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://paggxsvqosfduuqlgydl.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZ2d4c3Zxb3NmZHV1cWxneWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyMzUxNDQsImV4cCI6MjA1NjgxMTE0NH0.eyJJw3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZ2d4c3Zxb3NmZHV1cWxneWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyMzUxNDQsImV4cCI6MjA1NjgxMTE0NH0";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default function LeadDashboard() {
  const [leads, setLeads] = useState([]);
  const [filter, setFilter] = useState("Hot Lead");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeads() {
      try {
        let query = supabase.table("bizmap_leads").select("*").order("lead_score", { ascending: false });
        if (filter) {
          query = query.eq("status", filter);
        }
        const { data, error } = await query;
        if (error) throw error;
        setLeads(data || []);
      } catch (err) {
        console.error("Error fetching leads:", err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchLeads();
  }, [filter]);

  return (
    <main className="p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-gray-900">Auralink Digital CRM Leads</h1>
      <div className="flex gap-4 mb-6">
        {["Hot Lead", "Warm Lead", "Cold"].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === status ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            {status}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="text-gray-600">Loading pipeline leads...</p>
      ) : (
        <div className="bg-white shadow-md rounded-lg overflow-hidden border border-gray-200">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-200 text-gray-700">
                <th className="p-4 font-semibold">Business Name</th>
                <th className="p-4 font-semibold">Score</th>
                <th className="p-4 font-semibold">Phone</th>
                <th className="p-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan="4" className="p-6 text-center text-gray-500">No leads found in this category.</td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id || lead.name} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="p-4 font-medium text-gray-900">{lead.name}</td>
                    <td className="p-4 text-blue-600 font-semibold">{lead.lead_score}</td>
                    <td className="p-4 text-gray-600">{lead.phone || "N/A"}</td>
                    <td className="p-4"><span className="px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800">{lead.status}</span></td>
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