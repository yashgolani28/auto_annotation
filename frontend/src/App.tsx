import React from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { useAuth } from "./state/auth"
import Layout from "./components/Layout"

import Login from "./pages/Login"
import Projects from "./pages/Projects"
import ProjectDashboard from "./pages/ProjectDashboard"
import Annotate from "./pages/Annotate"
import AutoAnnotate from "./pages/AutoAnnotate"
import ViewAutoAnnotations from "./pages/ViewAutoAnnotations"
import ExportPage from "./pages/ExportPage"
import AdminUsers from "./pages/AdminUsers"
import Jobs from "./pages/Jobs"

function Protected({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth()
  if (!accessToken) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/" element={<Protected><Projects /></Protected>} />
      <Route path="/project/:id" element={<Protected><ProjectDashboard /></Protected>} />
      <Route path="/project/:id/annotate" element={<Protected><Annotate /></Protected>} />
      <Route path="/project/:id/auto" element={<Protected><AutoAnnotate /></Protected>} />
      <Route path="/project/:id/view-auto" element={<Protected><ViewAutoAnnotations /></Protected>} />
      <Route path="/project/:id/export" element={<Protected><ExportPage /></Protected>} />
      <Route path="/project/:id/jobs" element={<Protected><Jobs /></Protected>} />

      <Route path="/admin/users" element={<Protected><AdminUsers /></Protected>} />
    </Routes>
  )
}
