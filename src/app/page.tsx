"use client";
import { useState, useEffect } from "react";

export default function Home() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 750;

  useEffect(() => {
    async function fetchLeadsFromServer() {
      setLoading(true);
      try {
        const response = await fetch(`/api/leads?page=${page}`);
        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || "Failed to fetch from server route");
        }

        setLeads(result.data);
        setTotalCount(result.count);
      } catch (err: any) {
        console.error("Error loading leads:", err.message);
        setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchLeadsFromServer();
  }, [page]);

  const maxPages = Math.ceil(totalCount / pageSize);

  return (
    <main className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Auralink Digital CRM Pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">Managing {totalCount ? totalCount.toLocaleString() : "17,330"} database records</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="bg-blue-100 text-blue-800 text-sm font-semibold px-3 py-1 rounded-full">
            Page {page + 1} of {maxPages || 1} ({leads.length} in view)
          </span>
          <div className="flex gap-2">
            <button 
              onClick={() => setPage((p) => Math.max(p - 1, 0))}
              disabled={page === 0 || loading}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg disabled:opacity-50 hover:bg-gray-300 font-medium text-sm"
            >
              Previous
            </button>
            <button 
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) >= maxPages || loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 hover:bg-blue-700 font-medium text-sm"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      
      {errorMessage && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          <strong>Database Error:</strong> {errorMessage}
        </div>
      )}

      {loading ? (
        <p className="text-gray-600">Fetching 750-record chunk from server...</p>
      ) : (
        <div className="bg-white shadow-md rounded-lg overflow-hidden border border-gray-200">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-200 text-gray-700 text-sm">
                <th className="p-4 font-semibold">Business Name</th>
                <th className="p-4 font-semibold">Type</th>
                <th className="p-4 font-semibold">Phone</th>
                <th className="p-4 font-semibold">Email</th>
                <th className="p-4 font-semibold">Address</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-500">No records found in bizmap_leads.</td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-gray-100 hover:bg-gray-50 text-sm">
                    <td className="p-4 font-medium text-gray-900">{lead.business_name || "Unnamed"}</td>
                    <td className="p-4 text-blue-600 font-semibold">{lead.business_type || "N/A"}</td>
                    <td className="p-4 text-gray-600">{lead.phone || "No phone"}</td>
                    <td className="p-4 text-gray-600">{lead.email || "No email"}</td>
                    <td className="p-4 text-gray-500 truncate max-w-xs">{lead.address || "N/A"}</td>
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
