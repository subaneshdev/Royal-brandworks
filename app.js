// Supabase Connection Configuration
const SUPABASE_URL = "https://ardhshfwlhndfpoqixsp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyZGhzaGZ3bGhuZGZwb3FpeHNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNjA5NDgsImV4cCI6MjA5OTkzNjk0OH0.cbS0uTxMlDWedT1SvX-6Q69PrFdl8oMGVq0md9ar6yc";

let supabaseClient;
try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    console.error("Supabase load error:", e);
}

// Generate UUID safely on both secure/non-secure origins
function getUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Application State
let state = {
    currentTab: 'dashboard',
    clientFilter: 'all',
    workorderClientFilter: 'all',
    expandedClientId: null,
    clients: [],
    jobs: [],
    clientPhotos: [],
    cashflow: {},
    activeJobId: null
};

// Initial Load
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    setupNavigation();
    setupEventHandlers();
    
    await refreshAllData();
});

// Refresh Data Loop
async function refreshAllData() {
    try {
        await Promise.all([
            fetchClients(),
            fetchJobs(),
            fetchClientPhotos(),
            fetchCashflow()
        ]);
        
        recalculateFinancials();
        renderActiveView();
        populateFormDropdowns();
    } catch (err) {
        console.error("Error refreshing data:", err);
    }
}

// Fetchers
async function fetchClients() {
    const { data, error } = await supabaseClient.from('clients').select('*').order('name');
    if (!error) state.clients = data || [];
}

async function fetchJobs() {
    const { data, error } = await supabaseClient.from('jobs').select('*').order('date_issued', { ascending: false });
    if (!error) state.jobs = data || [];
}

async function fetchClientPhotos() {
    const { data, error } = await supabaseClient.from('client_photos').select('*').order('created_at', { ascending: false });
    if (!error) state.clientPhotos = data || [];
}

async function fetchCashflow() {
    const { data, error } = await supabaseClient.from('cashflow').select('*');
    if (!error && data) {
        const cfMap = {};
        data.forEach(item => {
            cfMap[item.id] = parseFloat(item.value);
        });
        state.cashflow = cfMap;
    }
}

// Financial calculations
function getClientRollup(clientId) {
    const clientJobs = state.jobs.filter(j => j.client_id === clientId);
    const budget = clientJobs.reduce((sum, j) => sum + parseFloat(j.budget || 0), 0);
    const expense = clientJobs.reduce((sum, j) => sum + parseFloat(j.expense || 0), 0);
    const profit = clientJobs.reduce((sum, j) => sum + parseFloat(j.profit || 0), 0);
    return { budget, expense, profit };
}

function recalculateFinancials() {
    // 1. Revenue: budgets of all completed projects (where status is 'Payment')
    const completedJobsBudget = state.jobs
        .filter(j => j.status === 'Payment')
        .reduce((sum, j) => sum + parseFloat(j.budget || 0), 0);

    // 2. Expense: total expenses of all projects (ongoing + completed) + manual base expense
    const totalJobsExpense = state.jobs.reduce((sum, j) => sum + parseFloat(j.expense || 0), 0);
    const baseExpense = state.cashflow['expense'] || 0;
    const totalExpense = totalJobsExpense + baseExpense;

    const totalRevenue = completedJobsBudget;
    const netProfit = totalRevenue - totalExpense;

    // 3. Investment (manual entry)
    const investment = state.cashflow['investment'] || 0;

    // 4. Working Capital = Investment + Net Profit
    const workingCapital = investment + netProfit;

    // 5. Running Capital = 60% of Working Capital
    const runningCapital = workingCapital * 0.6;

    // Save calculations into state
    state.overallFinancials = {
        revenue: totalRevenue,
        expense: totalExpense,
        profit: netProfit,
        investment,
        workingCapital,
        runningCapital
    };

    // Update sticky summary strip
    document.getElementById('summary-revenue').textContent = formatINR(totalRevenue);
    document.getElementById('summary-expense').textContent = formatINR(totalExpense);
    document.getElementById('summary-profit').textContent = formatINR(netProfit);
}

// Format INR Helper
function formatINR(number) {
    const parsed = parseFloat(number) || 0;
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(parsed);
}

// Helper to convert files to Base64 URL
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// Tab Switching Navigation
function setupNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            switchTab(targetTab);
        });
    });
}

function switchTab(tabId) {
    state.currentTab = tabId;
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    document.querySelectorAll('.content-view').forEach(view => {
        if (view.id === `view-${tabId}`) {
            view.classList.add('active');
        } else {
            view.classList.remove('active');
        }
    });

    renderActiveView();
}

// View Renderer Dispatcher
function renderActiveView() {
    switch (state.currentTab) {
        case 'dashboard':
            renderDashboard();
            break;
        case 'clients':
            renderClients();
            break;
        case 'workorders':
            renderWorkOrders();
            break;
        case 'tracking':
            renderTracking();
            break;
        case 'gallery':
            renderGallery();
            break;
    }
    lucide.createIcons();
}

// View 1: Dashboard overall financials
function renderDashboard() {
    const financials = state.overallFinancials;
    if (!financials) return;

    document.getElementById('dash-investment').textContent = formatINR(financials.investment);
    document.getElementById('dash-working-capital').textContent = formatINR(financials.workingCapital);
    document.getElementById('dash-running-capital').textContent = formatINR(financials.runningCapital);
    document.getElementById('dash-revenue').textContent = formatINR(financials.revenue);
    document.getElementById('dash-expense').textContent = formatINR(financials.expense);
    document.getElementById('dash-profit').textContent = formatINR(financials.profit);
}

// View 2: Clients Directory
function renderClients() {
    const list = document.getElementById('clients-list');
    list.innerHTML = '';

    let filtered = state.clients;
    if (state.clientFilter !== 'all') {
        filtered = filtered.filter(c => c.type === state.clientFilter);
    }

    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No clients found.</p></div>';
        return;
    }

    filtered.forEach(client => {
        const rollup = getClientRollup(client.id);
        const clientJobs = state.jobs.filter(j => j.client_id === client.id);
        const ongoingJobs = clientJobs.filter(j => j.status !== 'Payment');
        const pastJobs = clientJobs.filter(j => j.status === 'Payment');
        const isExpanded = state.expandedClientId === client.id;

        const container = document.createElement('div');
        container.className = 'client-list-item-container';
        
        container.innerHTML = `
            <div class="client-list-item">
                <div class="left-info">
                    <div class="logo-container" style="width: 36px; height: 36px;">
                        ${client.logo ? `<img src="${client.logo}" alt="Logo">` : `<span class="logo-placeholder" style="font-size: 14px;">${client.name.charAt(0)}</span>`}
                    </div>
                    <div>
                        <strong style="font-size: 15px;">${client.name}</strong>
                        <div style="font-size: 11px; color: var(--text-secondary);">${client.type} • Projects: ${clientJobs.length}</div>
                    </div>
                </div>
                <div class="right-actions">
                    <button class="btn btn-primary" onclick="event.stopPropagation(); openCreateJobForClient('${client.id}')" style="min-height: 32px; padding: 0 10px; font-size: 12px; margin-right: 8px;">
                        <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Create Job
                    </button>
                    <i data-lucide="${isExpanded ? 'chevron-up' : 'chevron-down'}" style="color: var(--text-secondary);"></i>
                </div>
            </div>
            
            <div class="client-detail-panel ${isExpanded ? '' : 'hidden'}">
                <div class="financial-summary-grid">
                    <div class="fin-card">
                        <span class="label">Total Budget</span>
                        <span class="val" style="color: var(--success);">${formatINR(rollup.budget)}</span>
                    </div>
                    <div class="fin-card">
                        <span class="label">Total Expense</span>
                        <span class="val" style="color: var(--danger);">${formatINR(rollup.expense)}</span>
                    </div>
                    <div class="fin-card">
                        <span class="label">Net Margin</span>
                        <span class="val" style="color: var(--primary);">${formatINR(rollup.budget - rollup.expense)}</span>
                    </div>
                </div>
                
                <div class="jobs-lists-grid">
                    <div class="jobs-section">
                        <h5>Ongoing Projects (${ongoingJobs.length})</h5>
                        ${ongoingJobs.length === 0 ? '<div style="font-size: 11px; color: var(--text-secondary); padding: 4px 0;">No active projects</div>' : ''}
                        ${ongoingJobs.map(j => `
                            <div class="inner-job-row" onclick="navigateToJobTracking('${j.id}')">
                                <span class="title">${j.title}</span>
                                <span class="budget-tag">${formatINR(j.budget)}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="jobs-section">
                        <h5>Past Projects (${pastJobs.length})</h5>
                        ${pastJobs.length === 0 ? '<div style="font-size: 11px; color: var(--text-secondary); padding: 4px 0;">No completed projects</div>' : ''}
                        ${pastJobs.map(j => `
                            <div class="inner-job-row" onclick="navigateToJobTracking('${j.id}')">
                                <span class="title">${j.title}</span>
                                <span class="budget-tag" style="color: var(--text-secondary);">${formatINR(j.budget)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        container.querySelector('.client-list-item').addEventListener('click', () => {
            state.expandedClientId = isExpanded ? null : client.id;
            renderClients();
        });

        list.appendChild(container);
    });
    lucide.createIcons();
}

window.navigateToJobTracking = function(jobId) {
    state.activeJobId = jobId;
    switchTab('tracking');
};

window.openCreateJobForClient = function(clientId) {
    document.getElementById('job-client-id').value = clientId;
    document.getElementById('modal-job').classList.remove('hidden');
};

// View 3: Work Orders directory
function renderWorkOrders() {
    const tbody = document.getElementById('work-orders-tbody');
    tbody.innerHTML = '';

    let filtered = state.jobs;
    if (state.workorderClientFilter !== 'all') {
        filtered = filtered.filter(j => j.client_id === state.workorderClientFilter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No work orders found.</td></tr>';
        return;
    }

    filtered.forEach(job => {
        const client = state.clients.find(c => c.id === job.client_id);
        const clientName = client ? client.name : 'Unknown Client';
        
        const dateStr = new Date(job.date_issued).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });

        const tr = document.createElement('tr');
        tr.className = 'clickable';
        tr.innerHTML = `
            <td><strong>#${job.title}</strong></td>
            <td>${clientName}</td>
            <td>${job.assigned_worker}</td>
            <td><span class="pill ${job.status === 'Payment' ? 'pill-success' : 'pill-warning'}">${job.status}</span></td>
            <td><span style="color: var(--success); font-weight: 700; font-variant-numeric: tabular-nums;">${formatINR(job.profit)}</span></td>
            <td>${dateStr}</td>
        `;
        tr.addEventListener('click', () => {
            state.activeJobId = job.id;
            switchTab('tracking');
        });
        tbody.appendChild(tr);
    });
}

// View 4: Process & Work Tracking
function renderTracking() {
    const list = document.getElementById('tracking-jobs-list');
    list.innerHTML = '';

    if (state.jobs.length === 0) {
        list.innerHTML = '<p class="empty-state">No jobs/projects available to track.</p>';
        return;
    }

    state.jobs.forEach(job => {
        const client = state.clients.find(c => c.id === job.client_id);
        const item = document.createElement('div');
        item.className = `job-select-item ${state.activeJobId === job.id ? 'active' : ''}`;
        item.innerHTML = `
            <div>
                <div class="title">${job.title}</div>
                <div style="font-size: 11px; color: var(--text-secondary);">${client ? client.name : 'Client'}</div>
            </div>
            <span class="pill ${job.status === 'Payment' ? 'pill-success' : 'pill-warning'}" style="font-size: 9px; padding: 2px 4px;">${job.status}</span>
        `;
        item.addEventListener('click', () => {
            state.activeJobId = job.id;
            renderTracking();
        });
        list.appendChild(item);
    });

    const activeContent = document.getElementById('stepper-active-content');
    const emptyState = document.getElementById('stepper-empty-state');
    const addStepBtn = document.getElementById('btn-add-stepper-step');

    if (!state.activeJobId) {
        activeContent.classList.add('hidden');
        addStepBtn.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    activeContent.classList.remove('hidden');
    addStepBtn.classList.remove('hidden');
    emptyState.classList.add('hidden');

    const job = state.jobs.find(j => j.id === state.activeJobId);
    if (!job) return;

    const client = state.clients.find(c => c.id === job.client_id);

    document.getElementById('stepper-job-title').textContent = job.title;
    document.getElementById('stepper-job-subtitle').textContent = `Track progress and mark milestones for ${client ? client.name : 'client'}.`;

    const stepper = document.getElementById('milestone-stepper');
    stepper.innerHTML = '';

    const steps = job.milestone_steps || [];
    const firstUncompletedIndex = steps.findIndex(s => !s.completed);

    steps.forEach((step, idx) => {
        const isActiveStep = idx === firstUncompletedIndex;
        const stepRow = document.createElement('div');
        stepRow.className = `step-row ${step.completed ? 'completed' : ''} ${isActiveStep ? 'active' : ''}`;

        const isPayment = step.name.toLowerCase() === 'payment';
        const timestampStr = step.timestamp ? new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        stepRow.innerHTML = `
            <div class="step-top-row">
                <div class="step-indicator" onclick="toggleStep(${idx})">
                    ${step.completed ? '<i data-lucide="check" style="width: 14px; height: 14px;"></i>' : idx + 1}
                </div>
                <div class="step-details" onclick="toggleStep(${idx})">
                    <div class="step-name-row">
                        <span class="step-name">${step.name}</span>
                    </div>
                    <span class="step-desc">${step.description || ''}</span>
                    ${step.completed && timestampStr ? `<span class="step-time">Completed at ${timestampStr}</span>` : ''}
                </div>
                ${!isPayment ? `<button class="btn-delete-step" onclick="event.stopPropagation(); deleteStep(${idx})"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>` : ''}
            </div>
            
            ${isActiveStep ? `
                <div class="active-step-action-box">
                    <label class="checkbox-container">
                        <input type="checkbox" id="chk-active-step-completed" onchange="toggleStep(${idx})">
                        <span>Mark step as completed</span>
                    </label>
                </div>
            ` : ''}
        `;
        stepper.appendChild(stepRow);
    });

    if (client) {
        document.getElementById('overview-client-name').textContent = client.name;
        
        const dateOpt = { day: '2-digit', month: 'short', year: 'numeric' };
        document.getElementById('overview-start-date').textContent = client.start_date ? new Date(client.start_date).toLocaleDateString('en-IN', dateOpt) : 'Not set';
        document.getElementById('overview-deadline').textContent = client.deadline ? new Date(client.deadline).toLocaleDateString('en-IN', dateOpt) : 'Not set';
        
        const statusEl = document.getElementById('overview-status');
        statusEl.textContent = client.status || 'On Track';
        statusEl.className = `pill ${client.status === 'On Track' ? 'pill-success' : client.status === 'Delayed' ? 'pill-danger' : 'pill-neutral'}`;

        const utilizedVal = parseFloat(job.expense) || 0;
        const totalVal = parseFloat(job.budget) || 1;
        const percent = Math.min(Math.round((utilizedVal / totalVal) * 100), 100);

        document.getElementById('budget-value').textContent = formatINR(utilizedVal);
        document.getElementById('budget-limit-value').textContent = `/ ${formatINR(totalVal)}`;
        document.getElementById('budget-progress-bar').style.width = `${percent}%`;
        document.getElementById('budget-utilization-percent').textContent = `${percent}% utilized`;
    }
    lucide.createIcons();
}

window.toggleStep = async function(stepIndex) {
    if (!state.activeJobId) return;
    const job = state.jobs.find(j => j.id === state.activeJobId);
    if (!job) return;

    const steps = [...job.milestone_steps];
    const step = steps[stepIndex];

    step.completed = !step.completed;
    step.timestamp = step.completed ? new Date().toISOString() : null;

    let newStatus = 'Initial Consultation';
    for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].completed) {
            newStatus = steps[i].name;
            break;
        }
    }

    // Auto-calculate profit = budget - expense if terminal Payment step is checked/completed
    let newProfit = parseFloat(job.profit) || 0;
    if (newStatus === 'Payment') {
        newProfit = (parseFloat(job.budget) || 0) - (parseFloat(job.expense) || 0);
    }

    try {
        const { error } = await supabaseClient
            .from('jobs')
            .update({ milestone_steps: steps, status: newStatus, profit: newProfit })
            .eq('id', job.id);
        
        if (error) throw error;
    } catch (e) {
        console.error("Update step failed", e);
    }
    await refreshAllData();
};

window.deleteStep = async function(stepIndex) {
    if (!state.activeJobId) return;
    const job = state.jobs.find(j => j.id === state.activeJobId);
    if (!job) return;

    const steps = [...job.milestone_steps];
    if (steps[stepIndex].name.toLowerCase() === 'payment') return;

    steps.splice(stepIndex, 1);

    let newStatus = 'Initial Consultation';
    for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].completed) {
            newStatus = steps[i].name;
            break;
        }
    }

    try {
        const { error } = await supabaseClient
            .from('jobs')
            .update({ milestone_steps: steps, status: newStatus })
            .eq('id', job.id);
            
        if (error) throw error;
    } catch (e) {
        console.error("Delete step failed", e);
    }
    await refreshAllData();
};

// View 5: Brand Gallery
function renderGallery() {
    const photoGrid = document.getElementById('gallery-photo-grid');
    photoGrid.innerHTML = '';

    const selectedClientId = document.getElementById('gallery-client-select').value;
    
    let filteredPhotos = state.clientPhotos;
    if (selectedClientId && selectedClientId !== '') {
        filteredPhotos = filteredPhotos.filter(p => p.client_id === selectedClientId);
    }

    if (filteredPhotos.length === 0) {
        photoGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><p>No brand assets uploaded for this client yet.</p></div>';
        return;
    }

    filteredPhotos.forEach(photo => {
        const dateStr = new Date(photo.created_at).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short'
        });

        const card = document.createElement('div');
        card.className = 'photo-card';
        card.innerHTML = `
            <img src="${photo.url}" alt="Gallery Asset">
            <div class="caption">${photo.caption || 'Brand Asset'}</div>
            <div class="date">Uploaded ${dateStr}</div>
        `;
        photoGrid.appendChild(card);
    });
}

function populateFormDropdowns() {
    const gallerySelect = document.getElementById('gallery-client-select');
    const selectedGal = gallerySelect.value;
    gallerySelect.innerHTML = '<option value="">-- View All Gallery Photos --</option>';

    state.clients.forEach(c => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = c.name;
        gallerySelect.appendChild(option);
    });
    if (selectedGal) gallerySelect.value = selectedGal;

    const jobClientSelect = document.getElementById('job-client-id');
    jobClientSelect.innerHTML = '<option value="">-- Choose Client --</option>';
    state.clients.forEach(c => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = c.name;
        jobClientSelect.appendChild(option);
    });

    const woClientFilterSelect = document.getElementById('workorder-client-filter');
    const selectedWOFilter = woClientFilterSelect.value;
    woClientFilterSelect.innerHTML = '<option value="all">All Clients</option>';
    state.clients.forEach(c => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = c.name;
        woClientFilterSelect.appendChild(option);
    });
    if (selectedWOFilter) woClientFilterSelect.value = selectedWOFilter;
}

// Event Handlers Configuration
function setupEventHandlers() {
    const segButtons = document.querySelectorAll('#view-clients .segment-btn');
    segButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            segButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.clientFilter = btn.getAttribute('data-client-filter');
            renderClients();
        });
    });

    document.getElementById('btn-add-client').addEventListener('click', () => {
        document.getElementById('modal-client').classList.remove('hidden');
    });

    document.getElementById('btn-close-client-modal').addEventListener('click', () => {
        document.getElementById('modal-client').classList.add('hidden');
    });

    document.getElementById('form-create-client').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('client-name').value;
        const type = document.getElementById('client-type').value;
        const logoFile = document.getElementById('client-logo-file').files[0];
        let logoBase64 = null;

        if (logoFile) {
            logoBase64 = await fileToBase64(logoFile);
        }

        const newClient = {
            id: getUUID(),
            name,
            type,
            logo: logoBase64,
            status: 'On Track',
            created_at: new Date().toISOString()
        };

        try {
            const { error } = await supabaseClient
                .from('clients')
                .insert([newClient]);
            if (error) throw error;
        } catch (err) {
            console.error("Create client error:", err);
            alert("Error creating client: " + err.message);
        }

        document.getElementById('modal-client').classList.add('hidden');
        document.getElementById('form-create-client').reset();
        await refreshAllData();
    });

    // Create Job Modal Triggers (Varying triggers across pages)
    document.getElementById('btn-add-job').addEventListener('click', () => {
        document.getElementById('modal-job').classList.remove('hidden');
    });

    document.getElementById('btn-close-job-modal').addEventListener('click', () => {
        document.getElementById('modal-job').classList.add('hidden');
    });

    document.getElementById('form-create-job').addEventListener('submit', async (e) => {
        e.preventDefault();
        const clientId = document.getElementById('job-client-id').value;
        const title = document.getElementById('job-title').value;
        const scope = document.getElementById('job-scope').value;
        const worker = document.getElementById('job-worker').value;
        const budget = parseFloat(document.getElementById('job-budget').value) || 0;
        const expense = parseFloat(document.getElementById('job-expense').value) || 0;
        const profit = parseFloat(document.getElementById('job-profit').value) || 0;

        const newJob = {
            id: getUUID(),
            client_id: clientId,
            title: title,
            scope_summary: scope,
            assigned_worker: worker,
            profit: profit,
            budget: budget,
            expense: expense,
            status: 'Initial Consultation',
            date_issued: new Date().toISOString(),
            milestone_steps: [
                {"name": "Initial Consultation", "completed": true, "timestamp": new Date().toISOString(), "description": "Client meeting to discuss requirements and scope."},
                {"name": "Design Drafts Submitted", "completed": false, "timestamp": null, "description": "First round of concepts sent for review."},
                {"name": "Client Revisions", "completed": false, "timestamp": null, "description": "Implement feedback from review sessions."},
                {"name": "Payment", "completed": false, "timestamp": null, "description": "Final invoice generation and payment confirmation."}
            ]
        };

        try {
            const { error } = await supabaseClient
                .from('jobs')
                .insert([newJob]);
            if (error) throw error;
        } catch (err) {
            console.error("Create job error:", err);
            alert("Error creating job: " + err.message);
        }

        document.getElementById('modal-job').classList.add('hidden');
        document.getElementById('form-create-job').reset();
        await refreshAllData();
    });

    // Tracking custom step actions
    document.getElementById('btn-add-stepper-step').addEventListener('click', () => {
        document.getElementById('modal-add-step').classList.remove('hidden');
    });

    document.getElementById('btn-close-step-modal').addEventListener('click', () => {
        document.getElementById('modal-add-step').classList.add('hidden');
    });

    document.getElementById('form-add-step').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.activeJobId) return;

        const name = document.getElementById('new-step-name').value;
        const description = document.getElementById('new-step-desc').value;

        const job = state.jobs.find(j => j.id === state.activeJobId);
        if (!job) return;

        const steps = [...job.milestone_steps];
        
        const newStepObj = {
            name: name,
            completed: false,
            timestamp: null,
            description: description
        };

        const insertIndex = Math.max(steps.length - 1, 0);
        steps.splice(insertIndex, 0, newStepObj);

        try {
            const { error } = await supabaseClient
                .from('jobs')
                .update({ milestone_steps: steps })
                .eq('id', job.id);
            if (error) throw error;
        } catch (err) {
            console.error("Add step error:", err);
        }

        document.getElementById('modal-add-step').classList.add('hidden');
        document.getElementById('form-add-step').reset();
        await refreshAllData();
    });

    // Update Job Expense Modal triggers
    document.getElementById('btn-update-job-expense').addEventListener('click', () => {
        if (!state.activeJobId) return;
        const job = state.jobs.find(j => j.id === state.activeJobId);
        if (!job) return;

        document.getElementById('update-job-expense-value').value = job.expense || 0;
        document.getElementById('modal-update-expense').classList.remove('hidden');
    });

    document.getElementById('btn-close-expense-modal').addEventListener('click', () => {
        document.getElementById('modal-update-expense').classList.add('hidden');
    });

    document.getElementById('form-update-expense').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.activeJobId) return;

        const expenseVal = parseFloat(document.getElementById('update-job-expense-value').value) || 0;

        try {
            const { error } = await supabaseClient
                .from('jobs')
                .update({ expense: expenseVal })
                .eq('id', state.activeJobId);
            if (error) throw error;
        } catch (err) {
            console.error("Update expense error:", err);
            alert("Error updating expense: " + err.message);
        }

        document.getElementById('modal-update-expense').classList.add('hidden');
        await refreshAllData();
    });

    // Dashboard click updates for Investment & Base Expense
    document.getElementById('node-investment').addEventListener('click', () => {
        const currentVal = state.cashflow['investment'] || 0;
        document.getElementById('cf-node-key').value = 'investment';
        document.getElementById('cf-modal-title').textContent = 'Update Investment';
        document.getElementById('cf-node-value').value = currentVal;
        document.getElementById('modal-update-cashflow').classList.remove('hidden');
    });

    document.getElementById('node-expense').addEventListener('click', () => {
        const currentVal = state.cashflow['expense'] || 0;
        document.getElementById('cf-node-key').value = 'expense';
        document.getElementById('cf-modal-title').textContent = 'Update Base Expense';
        document.getElementById('cf-node-value').value = currentVal;
        document.getElementById('modal-update-cashflow').classList.remove('hidden');
    });

    document.getElementById('btn-close-cf-modal').addEventListener('click', () => {
        document.getElementById('modal-update-cashflow').classList.add('hidden');
    });

    document.getElementById('form-update-cashflow').addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = document.getElementById('cf-node-key').value;
        const val = parseFloat(document.getElementById('cf-node-value').value) || 0;

        try {
            const { error } = await supabaseClient
                .from('cashflow')
                .upsert({ id: key, value: val, updated_at: new Date().toISOString() });
            if (error) throw error;
        } catch (err) {
            console.error("Update cashflow node error:", err);
            alert("Error updating cashflow: " + err.message);
        }

        document.getElementById('modal-update-cashflow').classList.add('hidden');
        await refreshAllData();
    });

    // Filtering select dropdown events
    document.getElementById('workorder-client-filter').addEventListener('change', () => {
        state.workorderClientFilter = document.getElementById('workorder-client-filter').value;
        renderWorkOrders();
    });

    document.getElementById('gallery-client-select').addEventListener('change', () => {
        renderGallery();
    });

    // Photo Upload
    document.getElementById('form-upload-gallery').addEventListener('submit', async (e) => {
        e.preventDefault();
        const clientId = document.getElementById('gallery-client-select').value;
        const caption = document.getElementById('gallery-caption').value;
        const file = document.getElementById('gallery-file').files[0];

        if (!clientId || clientId === '') {
            alert('Please select a specific Client to upload the photo under.');
            return;
        }

        if (file) {
            const base64Photo = await fileToBase64(file);
            
            const newPhotoObj = {
                id: getUUID(),
                client_id: clientId,
                url: base64Photo,
                caption: caption,
                created_at: new Date().toISOString()
            };

            try {
                const { error } = await supabaseClient
                    .from('client_photos')
                    .insert([newPhotoObj]);
                if (error) throw error;
            } catch (err) {
                console.error("Gallery upload error:", err);
                alert("Upload failed: " + err.message);
            }

            document.getElementById('form-upload-gallery').reset();
            await refreshAllData();
        }
    });
}
