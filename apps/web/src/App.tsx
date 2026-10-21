import { lazy, useEffect, useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/layout/AppShell'
import { useConfigStore } from '@/stores/config-store'

// Route-level code splitting.
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const PipelineEditorPage = lazy(() => import('@/features/pipeline-editor/PipelineEditorPage').then((m) => ({ default: m.PipelineEditorPage })))
const RobotConfigPage = lazy(() => import('@/features/robot-config/RobotConfigPage').then((m) => ({ default: m.RobotConfigPage })))
const ControllersPage = lazy(() => import('@/features/controllers/ControllersPage').then((m) => ({ default: m.ControllersPage })))
const SimulationPage = lazy(() => import('@/features/simulation/SimulationPage').then((m) => ({ default: m.SimulationPage })))
const ResultsPage = lazy(() => import('@/features/results/ResultsPage').then((m) => ({ default: m.ResultsPage })))
const ExperimentsPage = lazy(() => import('@/features/experiments/ExperimentsPage').then((m) => ({ default: m.ExperimentsPage })))

const createAppRouter = () =>
  createBrowserRouter([
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'pipeline', element: <PipelineEditorPage /> },
        { path: 'robot', element: <RobotConfigPage /> },
        { path: 'controllers', element: <ControllersPage /> },
        { path: 'simulation', element: <SimulationPage /> },
        { path: 'results', element: <ResultsPage /> },
        { path: 'experiments', element: <ExperimentsPage /> },
      ],
    },
  ])

export default function App() {
  const [router] = useState(createAppRouter)
  const init = useConfigStore((s) => s.init)
  useEffect(() => {
    void init()
  }, [init])
  return (
    <TooltipProvider delayDuration={300}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
