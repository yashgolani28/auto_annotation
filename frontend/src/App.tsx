import React from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Project from './pages/Project'
import Annotate from './pages/Annotate'
import AutoAnnotate from './pages/AutoAnnotate'
import ExportPage from './pages/ExportPage'

const Nav = () => (
  <div style={{ display: 'flex', gap: 12, padding: 12, borderBottom: '1px solid #eee' }}>
    <Link to="/">home</Link>
  </div>
)

export default function App() {
  return (
    <div>
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/project/:id" element={<Project />} />
        <Route path="/project/:id/annotate" element={<Annotate />} />
        <Route path="/project/:id/auto" element={<AutoAnnotate />} />
        <Route path="/project/:id/export" element={<ExportPage />} />
      </Routes>
    </div>
  )
}
