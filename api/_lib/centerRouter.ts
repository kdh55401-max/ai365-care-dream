import type { IncomingMessage, ServerResponse } from 'node:http'
import login from './centerHandlers/login.js'
import signup from './centerHandlers/signup.js'
import session from './centerHandlers/session.js'
import members from './centerHandlers/members.js'
import documents from './centerHandlers/documents.js'
import operations from './centerHandlers/operations.js'
import imports from './centerHandlers/imports.js'
import assignments from './centerHandlers/assignments.js'
import weeklyPlans from './centerHandlers/weekly-plans.js'
import planApplication from './centerHandlers/plan-application.js'
import monthSchedule from './centerHandlers/month-schedule.js'
import patientContracts from './centerHandlers/patient-contracts.js'
import patientRecognitions from './centerHandlers/patient-recognitions.js'
import patientRates from './centerHandlers/patient-rates.js'
import patientMemos from './centerHandlers/patient-memos.js'
import workerMemos from './centerHandlers/worker-memos.js'
import weekReviews from './centerHandlers/week-reviews.js'
import { sendJson } from './http.js'
export async function handleCenterRequest(req: IncomingMessage, res: ServerResponse) {
  const action = new URL(req.url || '/', 'https://localhost').searchParams.get('centerAction')
  switch (action) {
    case 'login': return login(req, res)
    case 'signup': return signup(req, res)
    case 'session': return session(req, res)
    case 'members': return members(req, res)
    case 'documents': return documents(req, res)
    case 'operations': return operations(req, res)
    case 'imports': return imports(req, res)
    case 'assignments': return assignments(req, res)
    case 'weekly-plans': return weeklyPlans(req, res)
    case 'plan-application': return planApplication(req, res)
    case 'month-schedule': return monthSchedule(req, res)
    case 'patient-contracts': return patientContracts(req, res)
    case 'worker-memos': return workerMemos(req, res)
    case 'patient-memos': return patientMemos(req, res)
    case 'week-reviews': return weekReviews(req, res)
    case 'patient-rates': return patientRates(req, res)
    case 'patient-recognitions': return patientRecognitions(req, res)
    default: sendJson(res, 404, { error: '지원하지 않는 회원 요청입니다.' })
  }
}
