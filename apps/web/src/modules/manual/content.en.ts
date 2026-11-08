import type { ManualText } from './sections'

export const contentEn: ManualText = {
  overview: {
    title: 'How the work flows',
    summary: 'Uniflow follows a print job from the customer PO to delivery. Everyone works in one system and sees the same live data.',
    blocks: [
      { p: 'Each job is handed from one person to the next in the order below, and each stage has a clear owner. Click a stage to see how to do it.' },
      { flow: true },
      { h: 'Terms to know' },
      {
        defs: [
          { term: 'PO / Sales order (SO)', desc: 'A purchase order the customer has confirmed. Every production job starts here. The SO number is generated for you.' },
          { term: 'Job', desc: 'A unit of production. One PO can split into several jobs, and one job can combine several lines of the same PO (gang printing).' },
          { term: 'Flow / step', desc: 'The production sequence of a job, such as print → laminate → cut → pack.' },
          { term: 'Workflow template', desc: 'A ready-made set of steps for a product type, which speeds up planning.' },
          { term: 'Release', desc: 'Puts an approved job into the real machine queue. Only then does it appear on the board and the shop floor.' },
        ],
      },
      { tip: '[[nav.proofs]], [[nav.outsource]], [[nav.deliveries]] and [[nav.inventory]] are optional modules. They appear only when enabled for your shop; if you do not see them, their parts of this manual are hidden too.' },
    ],
  },
  roles: {
    title: 'Roles and permissions',
    summary: 'Everyone can open most pages, but the buttons you can use depend on your role. One person can hold several roles.',
    blocks: [
      {
        defs: [
          { term: '[[role.admin]]', desc: 'Runs the shop account: invites members, assigns roles, changes shop settings.' },
          { term: '[[role.executive]]', desc: 'Sees all overviews and job details, read-only.' },
          { term: '[[role.manager]]', desc: 'Approves production plans, maintains master data and decides exceptions, such as releasing a job with short stock.' },
          { term: '[[role.supervisor]]', desc: 'Enters POs, plans jobs, arranges the queue, handles outsourcing and deliveries.' },
          { term: '[[role.staff]]', desc: 'Shop-floor crew: starts, pauses and finishes work, records good and waste quantities, reports downtime and issues materials.' },
        ],
      },
      { warn: 'Roles do not inherit: an [[role.admin]] **cannot** approve plans automatically. Approval needs the [[role.manager]] role. If one person does both, select both roles under [[nav.settings_page]] → [[settings.tabs.members]].' },
      { h: 'Who can do what' },
      {
        matrix: [
          { label: 'Enter POs, save drafts, confirm POs', roles: ['admin', 'manager', 'supervisor'] },
          { label: 'Reopen a confirmed PO / cancel a PO', roles: ['admin', 'manager'] },
          { label: 'Create jobs, plan, submit for approval', roles: ['admin', 'manager', 'supervisor'] },
          { label: 'Approve, reject, request changes', roles: ['manager'] },
          { label: 'Release to production, drag cards in the queue', roles: ['admin', 'manager', 'supervisor'] },
          { label: 'Release a job with short stock', roles: ['manager'] },
          { label: 'Start, pause, finish work, report downtime', roles: ['admin', 'manager', 'supervisor', 'staff'] },
          { label: 'Add rework steps, edit a flow', roles: ['admin', 'manager', 'supervisor'] },
          { label: 'Upload proofs', roles: ['admin', 'manager', 'supervisor', 'staff'] },
          { label: "Record the customer's proof decision", roles: ['admin', 'manager', 'supervisor'] },
          { label: 'Send, receive and QC outsourced work', roles: ['admin', 'manager', 'supervisor'] },
          { label: 'Receive stock', roles: ['admin', 'manager', 'supervisor'] },
          { label: 'Issue / return materials for a job', roles: ['admin', 'manager', 'supervisor', 'staff'] },
          { label: 'Adjust stock counts', roles: ['admin', 'manager'] },
          { label: 'Create delivery notes', roles: ['admin', 'manager', 'supervisor'] },
          { label: 'Close a short job', roles: ['admin', 'manager'] },
          { label: 'Edit machines, processes, shift calendar, materials', roles: ['admin', 'manager'] },
          { label: 'Edit customers, templates and vendors', roles: ['admin', 'manager', 'supervisor'] },
          { label: 'Invite members, assign roles, edit general shop settings', roles: ['admin'] },
        ],
      },
    ],
  },
  signin: {
    title: 'Signing in and the main screen',
    summary: 'How to get in the first time, and the parts of the screen shared by every page.',
    blocks: [
      { h: 'First sign-in' },
      {
        steps: [
          "Ask your shop's [[role.admin]] to invite your email address, then open the invitation link in the email.",
          'Choose a password of at least 6 characters and press [[auth.savePassword]].',
          'From then on, use [[auth.title]] with this email and password.',
        ],
      },
      { tip: 'If the link has expired, ask the [[role.admin]] for a new invitation. An email that already has an account joins the shop right away with no new password.' },
      { h: 'Parts of the screen' },
      {
        bullets: [
          '**Side menu** switches pages. On a phone it sits at the top and scrolls sideways.',
          '**Bell** next to the shop name shows notifications; click one to go straight to that work.',
          '**Below the menu** (on a computer) you can switch Thai/English, light/dark mode, and [[auth.signOut]].',
          '[[tenant.switch]] appears when your account belongs to more than one shop.',
        ],
      },
      { tip: 'Screens update by themselves when someone else makes a change, so there is no need to refresh.' },
    ],
  },
  setup: {
    title: 'First-time shop setup',
    summary: 'Do this once before going live, in this order, because each item depends on the one before.',
    blocks: [
      {
        steps: [
          '[[nav.settings_page]] → [[settings.tabs.general]]: enter the shop name and choose the document numbering ([[role.admin]]).',
          '[[nav.settings_page]] → [[settings.tabs.calendar]]: set shifts and holidays, which drive every start and finish time.',
          '[[nav.settings_page]] → [[settings.tabs.members]]: invite everyone and assign roles ([[role.admin]]).',
          '[[nav.processes]]: add the steps your shop performs, such as print, cut, laminate, pack.',
          '[[nav.machines]]: add machines with their capacity and the processes each can run.',
          '[[nav.templates]]: create step sets for your common products.',
          '[[nav.customers]]: add customers with their delivery addresses.',
          'If the modules are on: add vendors and materials in [[nav.settings_page]], then receive opening stock in [[nav.inventory]].',
        ],
      },
      { warn: 'Add [[nav.processes]] before [[nav.machines]], because a machine must be linked to the processes it can run. A machine with no link cannot be picked during planning.' },
      { tip: 'When done, run one test PO through every stage so that the whole team shares the same picture before real work starts.' },
    ],
  },
  orders: {
    title: 'Entering a customer PO',
    summary: 'Record the purchase order. Every job starts here.',
    blocks: [
      {
        steps: [
          'Go to [[nav.orders]] and press [[orders.add]].',
          'Upload the PO file (PDF / JPG / PNG, up to 20 MB) as the reference copy.',
          'Pick the customer and enter [[orders.poNo]], [[orders.poDate]] and [[orders.dueDate]].',
          'Fill in the lines: description, size, paper, colors, finishing, quantity, unit and price. Press [[orders.addLine]] for another line.',
          'Press [[orders.saveDraft]] if it is not complete yet. Once checked, press [[orders.confirm]].',
          'Press [[plan.open]] to move to the next stage.',
        ],
      },
      { warn: 'A confirmed PO cannot be edited. If a change is needed, a [[role.manager]] or [[role.admin]] can press [[orders.reopen]], but only while the PO has no jobs. If it has jobs, cancel them first.' },
      { p: 'A due date is required on the header or on every line. If one line ships on a different date, use [[orders.lineDue]].' },
      { p: 'The list can be searched by SO number, PO number or customer, and filtered by status. POs that are nearly due or overdue are colored.' },
    ],
  },
  plan: {
    title: 'Production planning',
    summary: 'Split a PO into jobs, set steps and machines, then send the plan to the manager.',
    blocks: [
      {
        steps: [
          'Open a confirmed PO and press [[plan.open]].',
          'Press [[plan.newJob]], name the job, choose a [[plan.template]], and tick the PO lines this job produces with their quantities.',
          'On the job card, check the steps, pick a machine for each, and enter [[plan.nUp]] and [[plan.passes]]. Time estimates are calculated for you.',
          'If you use inventory: add items under [[inventory.bom]], press [[inventory.calcSheets]] to work out paper, then [[inventory.saveBom]].',
          'Press [[plan.saveJob]].',
          'Check the left panel: every line must be matched and show [[plan.complete]]. If not, add another job.',
          'Press [[plan.submit]] at the bottom of the page.',
        ],
      },
      { tip: 'Put lines that share a sheet into one job. To split a single line, create several jobs and divide the quantity.' },
      { warn: 'The submit button stays disabled while lines are unmatched, a job has no steps, or a job has unsaved changes. The message beside the button says why.' },
      { p: 'A step with no machine waits in the [[board.unscheduled]] column on the board.' },
      { h: 'If a plan is sent back' },
      { p: 'The job returns to [[jobStatus.planning]] with the reason on its card. Fix it, press [[plan.saveJob]] and [[plan.submit]] again. A job that has not started can be removed with [[plan.cancelJob]], which frees its quantity for re-planning.' },
    ],
  },
  approvals: {
    title: 'Approving a plan',
    summary: 'The manager checks the whole PO plan before production starts.',
    blocks: [
      {
        steps: [
          'A notification and a counter on the [[nav.approvals]] menu show that a plan has arrived.',
          'Open [[nav.approvals]]. Jobs are grouped by PO with their flow, machines and estimated time.',
          "Press [[approvals.viewPo]] to compare with the customer's PO file.",
          'If the plan is right, press **Approve all** for that PO.',
          'If a job needs changes, press [[approvals.requestChange]] or [[approvals.reject]] on that job and enter a reason.',
        ],
      },
      { warn: 'By default you cannot approve a plan you submitted yourself. A shop with one manager can have the [[role.admin]] turn on [[settings.selfApproval]] under [[nav.settings_page]] → [[settings.tabs.general]]. Each such approval is recorded as self-approved.' },
      { p: 'Plans waiting more than 24 hours are highlighted here. After approval, jobs wait for release on the [[nav.board]].' },
    ],
  },
  board: {
    title: 'Release and queue',
    summary: 'The board shows job cards by machine. Start and finish times are calculated from shifts and the queue.',
    blocks: [
      { h: 'Release to production' },
      {
        steps: [
          'Go to [[nav.board]]. The bar at the top shows how many jobs are waiting.',
          'Press [[board.releaseAll]], or [[board.release]] on the planning page of that PO.',
          'Cards enter the machine queues right away and appear on the shop floor.',
        ],
      },
      { h: 'Arrange the queue by dragging' },
      {
        bullets: [
          'Drag a card up or down to reorder, or onto another machine. Times are recalculated and you are warned about jobs at risk.',
          'Only steps that have not started can be moved.',
          'The [[board.suggest]] button on a card lists other capable machines and the fastest one.',
          'The [[board.unscheduled]] column holds steps with no machine; drag them onto a machine.',
          'A machine set to [[status.maintenance]] takes no new work.',
        ],
      },
      { h: 'Reading the board' },
      {
        bullets: [
          'Click a card for details, and press [[board.detail.focus]] to see all of that job\'s steps on the board.',
          'Switch between [[board.viewBoard]] and [[board.viewTimeline]] to see the plan over time.',
          'Tick [[board.onlyRisk]] or search by job, PO or customer to filter cards.',
          'Press [[board.refresh]] to recalculate the queue from the current time.',
        ],
      },
      { tip: 'Each machine\'s Load bar compares queued work with working time. Over 100% means the machine is overbooked: move work or add a shift.' },
    ],
  },
  floor: {
    title: 'Recording work on the shop floor',
    summary: 'Operators press start, pause and finish on a phone or tablet. Big buttons, few taps.',
    blocks: [
      {
        steps: [
          'Open [[nav.floor]] and pick your machine at the top. The device remembers it. Work without a machine is under [[floor.noMachine]].',
          'Work through [[floor.next]] in order. Press [[floor.start]] when the work really starts.',
          'For a short stop, such as lunch or waiting for material, press [[floor.pause]], then [[floor.resume]] when you are back.',
          'When finished, press [[floor.complete]], enter [[floor.goodQty]], [[floor.wasteQty]] and the cause of any waste, then press [[floor.confirmComplete]].',
          'The next step opens automatically. When all steps are done the job becomes [[jobStatus.ready_to_deliver]].',
        ],
      },
      { tip: 'Scan the QR on the job ticket with a phone camera to open that step on the shop-floor screen directly.' },
      { h: 'When a machine stops' },
      {
        steps: [
          'Press [[floor.reportDown]], then choose the reason and the expected duration.',
          'Running work is paused, the queue shifts automatically, and supervisors are notified.',
          'When the machine is back, press [[floor.backUp]], then [[floor.resume]].',
        ],
      },
      { warn: 'A machine runs one job at a time: pause or finish the current one first. The button shows [[floor.waiting]] until the previous step is done.' },
      { p: 'Press the buttons when work actually starts and ends. These times drive the queue and delivery estimates. If waste exceeds the allowance or the quantity falls short, you are told to inform your supervisor.' },
      { p: 'If machines are assigned under [[nav.settings_page]] → [[settings.tabs.members]], staff see only those machines.' },
    ],
  },
  job: {
    title: 'Job page, tickets and changes',
    summary: 'Everything about a job in one place: plan vs actual, history, the ticket and changes during production.',
    blocks: [
      { p: 'Open it with [[board.detail.openJob]] from a board card, or click the job number on the shop floor. It shows planned vs actual times, good and waste per step, and [[job.activity]]: who did what and when.' },
      { h: 'Print the job ticket' },
      { p: 'Press [[job.ticket]] and print it to travel with the work. Each step has a QR code for operators to scan.' },
      { h: 'Redo part of a finished step' },
      {
        steps: [
          'On a finished step, press [[job.addRework]].',
          'Enter the quantity and the cause, then confirm.',
          'The rework step joins the machine queue automatically with no new approval.',
        ],
      },
      { h: 'Change the flow after approval' },
      {
        steps: [
          "Open the PO's planning page and press [[plan.editFlow]] on the job card.",
          'Add or change steps that have not started. Started steps are locked.',
          'Press [[plan.reflowSubmit]], enter a reason and wait for the manager.',
        ],
      },
      { warn: 'While a new flow waits for approval, running steps can continue but new steps cannot start. If the flow is rejected the job becomes [[jobStatus.on_hold]] until it is fixed and resubmitted.' },
    ],
  },
  proofs: {
    title: 'Artwork / Proof',
    summary: "Keep every version, record the customer's decision, and block production until it is approved.",
    blocks: [
      {
        steps: [
          'On the job page under [[proof.title]], choose the proof file (PDF or image), add a note and send it.',
          'Send the file to the customer your usual way. Customers do not sign in.',
          'When they reply, enter the approver\'s name and press [[proof.approve]], or press [[proof.reject]] with their comment.',
          'If changes are requested, upload the next version on the same job page. The old version is superseded but stays viewable.',
        ],
      },
      { p: '[[nav.proofs]] collects proofs waiting for the customer and those needing changes, so you can follow up each day.' },
      { warn: 'With [[settings.proofGate]] on, a design step cannot be finished until the customer\'s approval is recorded, so always record the answer in the system.' },
    ],
  },
  outsource: {
    title: 'Outsourced work',
    summary: 'Track work sent to vendors from dispatch to return and QC.',
    blocks: [
      {
        steps: [
          'When a job reaches an outsourced step, it appears under **To send** on [[nav.outsource]].',
          'Press [[outsource.send]] and choose the vendor, quantity, [[outsource.expected]] and cost.',
          'When it comes back, press [[outsource.receive]] under **At vendor** and enter the quantity received.',
          'Press [[outsource.qc]], then choose [[outsource.pass]] or [[outsource.reject]] with the quantity and reason.',
        ],
      },
      { p: 'After a pass, the next step can start right away. After a fail, the work returns to the To send lane to go back to the vendor.' },
      { tip: 'Overdue work turns red and triggers a notification. The [[outsource.vendors]] table summarizes punctuality, rejects and 90-day cost to help you choose vendors.' },
    ],
  },
  inventory: {
    title: 'Materials inventory',
    summary: 'See on-hand, reserved and short quantities, and issue materials against jobs.',
    blocks: [
      {
        defs: [
          { term: '[[inventory.onHand]]', desc: 'What is physically in stock.' },
          { term: '[[inventory.reserved]]', desc: 'Held for approved jobs.' },
          { term: '[[inventory.available]]', desc: 'On hand minus reserved, free for new work.' },
        ],
      },
      { h: 'Receive stock' },
      {
        steps: [
          'Go to [[nav.inventory]] and press [[inventory.receive]] on the material.',
          'Choose the unit, enter quantity, price and the delivery note number, then save.',
        ],
      },
      { h: 'Issue and return for a job' },
      {
        steps: [
          'Supervisors list materials while planning. They are reserved on approval and re-checked at release.',
          'On the job page under materials, press [[inventory.issue]] when you take the stock.',
          'If some is left over, press [[inventory.returnIt]], up to the amount issued.',
        ],
      },
      { h: 'Adjust after a physical count' },
      { p: 'Press [[inventory.adjust]] and enter the counted quantity and a reason. Only [[role.admin]] and [[role.manager]] can do this, and the count cannot go below what is reserved. See all history with [[inventory.card]].' },
      { warn: 'With [[settings.stockGate]] on, a job with short stock cannot be released. Receive stock first, or have a [[role.manager]] enter a reason to release it, which is kept in the job history.' },
      { tip: 'Use the [[inventory.short]] and [[inventory.belowMin]] filters to see what to order. Minimums are set under [[nav.settings_page]] → [[settings.tabs.materials]].' },
    ],
  },
  deliveries: {
    title: 'Delivering to the customer',
    summary: 'Create delivery notes for finished work, all at once or in parts.',
    blocks: [
      {
        steps: [
          'Go to [[nav.deliveries]]. Finished work is under [[delivery.ready]], grouped by PO.',
          'Press [[delivery.create]].',
          'Check [[delivery.qty]]. It defaults to the remaining quantity; change it for a part delivery.',
          'Enter [[delivery.receiver]] and [[delivery.date]], then save.',
          'Print the note for sender and receiver to sign. Older notes can be reprinted from [[delivery.history]].',
        ],
      },
      { p: 'After a part delivery the job is [[jobStatus.partially_delivered]], then [[jobStatus.completed]] when fully shipped. When all jobs of a PO are shipped, the PO becomes [[soStatus.delivered]] automatically.' },
      { p: 'You can ship only the good pieces actually produced. If a job came up short and no more will be made, a manager uses [[delivery.closeShort]] and gives the reason.' },
    ],
  },
  dashboard: {
    title: 'Overview',
    summary: 'The summary page for executives and supervisors: what needs attention today.',
    blocks: [
      {
        bullets: [
          '**Top figures**: [[dashboard.inProduction]], [[dashboard.atRisk]], [[dashboard.pendingApproval]], [[dashboard.readyToDeliver]] and [[dashboard.otd]].',
          "[[dashboard.todayOutput]]: today's good, waste and finished steps.",
          '[[dashboard.load]]: which machines are overbooked or free.',
          '[[dashboard.riskJobs]]: jobs not expected to make their due date.',
          '[[dashboard.downtime]] and [[dashboard.waste7d]]: where time and material are being lost.',
        ],
      },
      { tip: 'Start the day with [[dashboard.riskJobs]], then adjust the queue on the [[nav.board]].' },
    ],
  },
  notifications: {
    title: 'Notifications',
    summary: 'Click the bell to see the list, click an item to open that work, and press [[notifications.markAll]] to clear.',
    blocks: [
      {
        defs: [
          { term: '[[role.manager]]', desc: 'Plans to approve, overdue approvals, finished jobs, jobs at risk, machine stops, proofs and short stock.' },
          { term: '[[role.supervisor]]', desc: 'Jobs at risk, machine stops, proofs and short stock.' },
          { term: 'Plan submitter', desc: 'Plan approved, rejected or changes requested.' },
          { term: '[[role.executive]]', desc: 'Jobs finished and ready to deliver.' },
        ],
      },
    ],
  },
  processes: {
    title: 'Processes',
    summary: 'Your standard production steps, the basis for machines and templates.',
    blocks: [
      {
        steps: [
          'Go to [[nav.processes]] and press [[processes.add]].',
          'Enter a code and name, and choose the type.',
          'Enter [[processes.unit]], [[processes.setup]], [[processes.waste]] and [[processes.crew]], then save.',
        ],
      },
      {
        defs: [
          { term: '[[stepType.design]]', desc: 'Design work, linked to proof approval.' },
          { term: '[[stepType.internal]]', desc: 'Runs on a machine in your shop.' },
          { term: '[[stepType.outsource]]', desc: 'Sent to a vendor and managed on [[nav.outsource]].' },
          { term: '[[stepType.qc]] / [[stepType.delivery]]', desc: 'In-house checks or dispatch. With no machine linked they are recorded under [[floor.noMachine]].' },
        ],
      },
    ],
  },
  machines: {
    title: 'Machines',
    summary: 'Capacity per machine, used for the queue and load.',
    blocks: [
      {
        steps: [
          'Go to [[nav.machines]] and press [[machines.add]].',
          'Enter code, name, [[machines.capacity]], [[machines.setup]], [[machines.efficiency]] and [[machines.crew]].',
          'Tick [[machines.processes]] and save.',
        ],
      },
      { p: 'Use the status selector to set [[status.maintenance]] when a machine should take no new work. For a sudden breakdown use [[floor.reportDown]] on the shop floor instead, so the queue shifts and downtime is recorded.' },
      { p: 'Use [[machines.archive]] rather than deleting a machine you no longer use; its history stays and you can undo at once. Costs are visible only to [[role.admin]], [[role.manager]] and [[role.executive]].' },
    ],
  },
  templates: {
    title: 'Workflow templates',
    summary: 'Save the steps of common products, pick them when creating a job, and adjust per job.',
    blocks: [
      {
        steps: [
          'Go to [[nav.templates]], press [[templates.add]] and name it, such as Business cards or Packaging box.',
          'Pick processes below to add them one by one in production order.',
          'Set a [[templates.defaultMachine]] if a step normally uses one machine.',
          'Tick [[templates.parallel]] where work can run side by side, then save.',
        ],
      },
    ],
  },
  customers: {
    title: 'Customers',
    summary: 'Customer details used for POs and delivery notes.',
    blocks: [
      {
        steps: [
          'Go to [[nav.customers]] and press [[customers.add]].',
          'Enter code, name, [[customers.taxId]], [[customers.creditTerm]], contact and [[customers.address]], then save.',
        ],
      },
      { tip: 'The delivery address is copied into a new PO automatically, and can be changed on that PO alone.' },
    ],
  },
  settings: {
    title: 'Shop settings',
    summary: 'For [[role.admin]], [[role.manager]] and [[role.supervisor]]. Other roles see a no-permission message on this page.',
    blocks: [
      { h: '[[settings.tabs.general]]' },
      { p: 'Shop name, time zone, document numbering and shop rule switches. Only an [[role.admin]] can change these.' },
      {
        bullets: [
          '[[settings.selfApproval]]: for shops with a single manager.',
          '[[settings.stockGate]]: jobs with short stock cannot be released.',
          '[[settings.proofGate]]: a design step cannot finish until the customer approves.',
        ],
      },
      { h: '[[settings.tabs.members]]' },
      {
        steps: [
          'The [[role.admin]] presses [[settings.invite]], enters the email and picks roles. Choose [[settings.byInvite]] to email an invitation, or [[settings.byPassword]] to create an account that works right away, then give the member the email and password.',
          'Click a member to change roles, or deactivate them when they leave.',
          'Set [[settings.machines]] to limit who can run which machine. [[role.manager]] and [[role.supervisor]] can do this too.',
        ],
      },
      { h: '[[settings.tabs.calendar]]' },
      { p: 'Use [[settings.addShift]] for each day and [[settings.addHoliday]] for days off. All start and finish times use this, so enter holidays ahead of time; a wrong calendar makes every estimate wrong.' },
      { h: '[[settings.tabs.vendors]]' },
      { p: 'Press [[settings.vendorAdd]], then enter contacts, services and lead times, so the usual turnaround is shown when sending work.' },
      { h: '[[settings.tabs.materials]]' },
      { p: 'Press [[settings.materialAdd]], then enter category, stock unit, purchase unit, conversion and minimum stock. For example, buy by the ream and use by the sheet: 1 ream = 500 sheets.' },
    ],
  },
  statuses: {
    title: 'What the statuses mean',
    summary: 'Each status tells you where the work is and who it is waiting for.',
    blocks: [
      { h: 'PO status' },
      {
        defs: [
          { term: '[[soStatus.draft]]', desc: 'Not finished, can still be edited.' },
          { term: '[[soStatus.confirmed]]', desc: 'Confirmed and ready to plan.' },
          { term: '[[soStatus.in_progress]]', desc: 'The plan has been approved.' },
          { term: '[[soStatus.delivered]]', desc: 'All jobs fully delivered.' },
          { term: '[[soStatus.cancelled]]', desc: 'Cancelled, with the reason recorded.' },
        ],
      },
      { h: 'Job status' },
      {
        defs: [
          { term: '[[jobStatus.planning]]', desc: 'Being planned or sent back. The planner acts next.' },
          { term: '[[jobStatus.pending_approval]]', desc: 'Waiting for the manager.' },
          { term: '[[jobStatus.approved]]', desc: 'Approved, waiting for release.' },
          { term: '[[jobStatus.in_production]]', desc: 'On the production line.' },
          { term: '[[jobStatus.on_hold]]', desc: 'A new flow was rejected and must be fixed and resubmitted.' },
          { term: '[[jobStatus.ready_to_deliver]]', desc: 'All steps finished, waiting to ship.' },
          { term: '[[jobStatus.partially_delivered]]', desc: 'Part of it has shipped.' },
          { term: '[[jobStatus.completed]]', desc: 'Fully delivered.' },
          { term: '[[jobStatus.cancelled]]', desc: 'Cancelled; its quantity can be re-planned.' },
        ],
      },
      { h: 'Step status' },
      {
        defs: [
          { term: '[[stepStatus.pending]]', desc: 'The previous step is not finished.' },
          { term: '[[stepStatus.ready]]', desc: 'Can start now.' },
          { term: '[[stepStatus.in_progress]]', desc: 'Running; time is counting.' },
          { term: '[[stepStatus.paused]]', desc: 'Stopped for now; time is not counting.' },
          { term: '[[stepStatus.done]]', desc: 'Finished, with good and waste recorded.' },
        ],
      },
      { tip: 'The [[board.atRisk]] label means the expected finish is past the due date. Adjust the queue or warn the customer early.' },
    ],
  },
  trouble: {
    title: 'Common problems',
    summary: 'What on-screen messages mean and what to do.',
    blocks: [
      { h: "Can't see it or can't press it" },
      {
        defs: [
          { term: 'No approve button', desc: 'You need the [[role.manager]] role, even as an [[role.admin]].' },
          { term: 'Optional module menu missing', desc: 'It is not enabled for your shop. Contact your Uniflow provider.' },
          { term: 'No cards on the board or shop floor', desc: 'The job is not approved or not released yet. Check its status on the PO planning page.' },
          { term: 'My machine is missing on the shop floor', desc: 'Ask a supervisor to set your [[settings.machines]] under [[settings.tabs.members]].' },
          { term: 'Machine missing while planning', desc: 'It is not linked to that process, or its status is not [[status.active]].' },
          { term: "Can't drag a card", desc: 'The step has started, or your role is view-only.' },
        ],
      },
      { h: 'Common messages' },
      {
        defs: [
          { term: '[[plan.blockCoverage]]', desc: 'Some PO lines are not in a job. Check the remaining quantity in the left panel, then add a job or change quantities.' },
          { term: '[[errors.approval.self_approval]]', desc: 'Have another manager approve, or turn on [[settings.selfApproval]].' },
          { term: '[[errors.order.has_jobs]]', desc: 'Cancel the jobs of that PO first, then edit or cancel the PO.' },
          { term: '[[errors.step.not_ready]]', desc: 'Finish the previous step first.' },
          { term: '[[errors.step.machine_busy]]', desc: 'Pause or finish the work already on this machine.' },
          { term: '[[errors.step.machine_down]]', desc: 'Press [[floor.backUp]] once it is repaired.' },
          { term: '[[errors.step.not_your_machine]]', desc: 'Ask a supervisor to add you to this machine.' },
          { term: '[[errors.step.job_reapproval]]', desc: 'Wait for the manager to approve the new flow.' },
          { term: '[[board.cannotDrop]]', desc: 'Add this process to the machine on [[nav.machines]], or choose another machine.' },
          { term: '[[errors.proof.not_approved]]', desc: "Record the customer's answer on the job page first." },
          { term: '[[errors.release.stock_short]]', desc: 'Receive stock, or have a [[role.manager]] enter a reason to release.' },
          { term: '[[errors.step.conflict]]', desc: 'Someone changed it at the same time. Check the latest data and try again.' },
        ],
      },
    ],
  },
  platform: {
    title: 'For platform admins',
    summary: 'Shown only to the Uniflow provider team. Print shops do not see these menus.',
    blocks: [
      { h: 'Open a new shop' },
      {
        steps: [
          'Go to [[nav.adminUsers]] and press [[adminUsers.newShop]].',
          "Enter the shop name and its admin's email. An invitation is sent.",
          'Choose the modules for the shop. Menus and commands of disabled modules are hidden.',
        ],
      },
      { h: 'Look after existing shops' },
      {
        bullets: [
          '[[nav.admin]] lists every shop and lets you change plan and status.',
          '[[admin.enter]] opens a shop\'s data. A banner shows you are in support mode; press [[admin.leave]] when done.',
          '[[admin.seed]] adds sample data for a demo or training.',
        ],
      },
      { warn: 'Support access is recorded in the audit log, and the shop sees you as a temporary member.' },
    ],
  },
}
