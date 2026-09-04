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
    let query = supabase.table("bizmap_leads").select("*").order("lead_score", { ascending: false });