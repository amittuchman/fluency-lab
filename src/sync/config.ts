/**
 * Supabase project for cloud sync. The publishable key is meant to be public (it ships in every client);
 * what protects the data is Row Level Security in supabase/schema.sql. Never put a secret / service-role
 * key in this app. Override both values at build time with VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.
 */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || 'https://pnkfzaqnvykvjvcfbiof.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_d8TEg6EY9nNgL1DM_7prUw_BPrXeWSO'

/** Where the auth session is kept (localStorage). Its presence tells the app to restore a session on start. */
export const AUTH_STORAGE_KEY = 'fluency-lab-auth'
