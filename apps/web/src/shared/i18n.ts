import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const th = {
  app: { name: 'Uniflow', tagline: 'บริหารงานผลิตโรงพิมพ์' },
  nav: { board: 'บอร์ดงาน', dashboard: 'ภาพรวม', machines: 'เครื่องจักร', settings: 'ตั้งค่า', soon: 'เร็วๆ นี้' },
  auth: {
    title: 'เข้าสู่ระบบ',
    signupTitle: 'สร้างบัญชี',
    email: 'อีเมล',
    password: 'รหัสผ่าน',
    fullName: 'ชื่อ-นามสกุล',
    signIn: 'เข้าสู่ระบบ',
    signUp: 'สร้างบัญชี',
    toSignUp: 'ยังไม่มีบัญชี? สร้างบัญชี',
    toSignIn: 'มีบัญชีแล้ว? เข้าสู่ระบบ',
    checkEmail: 'ส่งลิงก์ยืนยันไปที่อีเมลแล้ว กรุณายืนยันก่อนเข้าสู่ระบบ',
    signOut: 'ออกจากระบบ',
  },
  onboarding: {
    title: 'เริ่มต้นใช้งาน Uniflow',
    subtitle: 'สร้างโรงพิมพ์ของคุณ ระบบจะเตรียมปฏิทินกะทำงานและคลังสินค้าเริ่มต้นให้',
    shopName: 'ชื่อโรงพิมพ์',
    create: 'สร้างโรงพิมพ์',
  },
  tenant: { switch: 'สลับโรงพิมพ์', create: 'สร้างโรงพิมพ์ใหม่' },
  machines: {
    title: 'เครื่องจักร',
    subtitle: 'กำลังผลิตของแต่ละเครื่อง ใช้คำนวณคิวและ Load',
    add: 'เพิ่มเครื่องจักร',
    empty: 'ยังไม่มีเครื่องจักร',
    emptyHint: 'เพิ่มเครื่องแรกเพื่อเริ่มจัดคิวงาน',
    search: 'ค้นหาเครื่อง…',
    code: 'รหัส',
    name: 'ชื่อเครื่อง',
    type: 'ประเภท',
    capacity: 'กำลังผลิต / ชม.',
    unit: 'หน่วย',
    setup: 'Setup (นาที)',
    efficiency: 'ประสิทธิภาพ %',
    crew: 'คนต่อเครื่อง',
    status: 'สถานะ',
    save: 'บันทึก',
    cancel: 'ยกเลิก',
    saved: 'บันทึกแล้ว',
    archive: 'เลิกใช้งาน',
    archived: 'เลิกใช้งานเครื่องแล้ว',
    undo: 'เลิกทำ',
  },
  status: { active: 'พร้อมใช้งาน', maintenance: 'ซ่อมบำรุง', inactive: 'ปิดใช้งาน' },
  unit: { sheet: 'แผ่น', impression: 'Impression', piece: 'ชิ้น', meter: 'เมตร', kg: 'กก.' },
  role: { admin: 'ผู้ดูแลระบบ', executive: 'ผู้บริหาร', manager: 'ผู้จัดการ', supervisor: 'หัวหน้างาน', staff: 'พนักงาน' },
  errors: {
    unknown: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง',
    duplicate: 'ข้อมูลนี้มีอยู่แล้ว (รหัสซ้ำ)',
    auth: { required: 'กรุณาเข้าสู่ระบบ', forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้', no_tenant: 'ยังไม่ได้เลือกโรงพิมพ์' },
    plan: { limit_reached: 'ถึงขีดจำกัดของแพ็กเกจแล้ว กรุณาอัปเกรด' },
    tenant: { name_required: 'กรุณาใส่ชื่อโรงพิมพ์', not_member: 'คุณไม่ได้เป็นสมาชิกของโรงพิมพ์นี้' },
    member: {
      user_not_found: 'ไม่พบผู้ใช้อีเมลนี้ ให้เขาสร้างบัญชีก่อน',
      roles_required: 'เลือกบทบาทอย่างน้อย 1 อย่าง',
      last_admin: 'ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน',
      not_found: 'ไม่พบสมาชิก',
    },
    machine: { not_found: 'ไม่พบเครื่องจักร' },
  },
}

const en: typeof th = {
  app: { name: 'Uniflow', tagline: 'Print production management' },
  nav: { board: 'Board', dashboard: 'Overview', machines: 'Machines', settings: 'Settings', soon: 'Soon' },
  auth: {
    title: 'Sign in',
    signupTitle: 'Create account',
    email: 'Email',
    password: 'Password',
    fullName: 'Full name',
    signIn: 'Sign in',
    signUp: 'Create account',
    toSignUp: 'No account? Create one',
    toSignIn: 'Have an account? Sign in',
    checkEmail: 'We sent a confirmation link to your email. Confirm it, then sign in.',
    signOut: 'Sign out',
  },
  onboarding: {
    title: 'Welcome to Uniflow',
    subtitle: 'Create your print shop. A default shift calendar and warehouse are set up for you.',
    shopName: 'Print shop name',
    create: 'Create print shop',
  },
  tenant: { switch: 'Switch shop', create: 'New print shop' },
  machines: {
    title: 'Machines',
    subtitle: 'Capacity per machine, used for queue and load planning',
    add: 'Add machine',
    empty: 'No machines yet',
    emptyHint: 'Add your first machine to start scheduling',
    search: 'Search machines…',
    code: 'Code',
    name: 'Name',
    type: 'Type',
    capacity: 'Capacity / hr',
    unit: 'Unit',
    setup: 'Setup (min)',
    efficiency: 'Efficiency %',
    crew: 'Crew size',
    status: 'Status',
    save: 'Save',
    cancel: 'Cancel',
    saved: 'Saved',
    archive: 'Archive',
    archived: 'Machine archived',
    undo: 'Undo',
  },
  status: { active: 'Active', maintenance: 'Maintenance', inactive: 'Inactive' },
  unit: { sheet: 'Sheets', impression: 'Impressions', piece: 'Pieces', meter: 'Meters', kg: 'kg' },
  role: { admin: 'Admin', executive: 'Executive', manager: 'Manager', supervisor: 'Supervisor', staff: 'Staff' },
  errors: {
    unknown: 'Something went wrong. Please try again.',
    duplicate: 'This already exists (duplicate code)',
    auth: { required: 'Please sign in', forbidden: "You don't have permission to do this", no_tenant: 'No print shop selected' },
    plan: { limit_reached: 'Plan limit reached. Please upgrade.' },
    tenant: { name_required: 'Enter a shop name', not_member: "You're not a member of this shop" },
    member: {
      user_not_found: 'No user with this email. Ask them to sign up first.',
      roles_required: 'Pick at least one role',
      last_admin: 'At least one admin is required',
      not_found: 'Member not found',
    },
    machine: { not_found: 'Machine not found' },
  },
}

const saved = (() => {
  try {
    return localStorage.getItem('uniflow.lang')
  } catch {
    return null
  }
})()

i18n.use(initReactI18next).init({
  resources: { th: { translation: th }, en: { translation: en } },
  lng: saved === 'en' ? 'en' : 'th',
  fallbackLng: 'th',
  interpolation: { escapeValue: false },
})

export function setLanguage(lang: 'th' | 'en') {
  i18n.changeLanguage(lang)
  try {
    localStorage.setItem('uniflow.lang', lang)
  } catch {
    // storage unavailable (private mode) — language still applies for this session
  }
}

export default i18n
