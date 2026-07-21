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

// Toast Notification Utility
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
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
    transactions: [],
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
            fetchTransactions()
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

async function fetchTransactions() {
    const { data, error } = await supabaseClient.from('transactions').select('*').order('date', { ascending: false });
    if (!error) state.transactions = data || [];
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
    // 1. Revenue: sum of all Job Inflow transactions
    const totalRevenue = state.transactions
        .filter(t => t.type === 'Job Inflow')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    // 2. Expense: sum of all Job Expense + Other Expense transactions
    const totalExpense = state.transactions
        .filter(t => t.type === 'Job Expense' || t.type === 'Other Expense')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    // 3. Net Profit = Revenue - Expense
    const netProfit = totalRevenue - totalExpense;

    // 4. Investment: sum of all Investment transactions
    const investment = state.transactions
        .filter(t => t.type === 'Investment')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    // 5. Working Capital = Investment + Net Profit
    const workingCapital = investment + netProfit;

    // 6. Running Capital = 60% of Working Capital
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

// Helper for Lucide icons mapping for Payment Methods
function getPaymentMethodIcon(method) {
    switch (method) {
        case 'Cash': return 'banknote';
        case 'UPI': return 'smartphone';
        case 'Card': return 'credit-card';
        case 'Cheque': return 'file-text';
        default: return 'help-circle';
    }
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

// View 1: Dashboard overall financials & Global Ledger
function renderDashboard() {
    const financials = state.overallFinancials;
    if (!financials) return;

    document.getElementById('dash-investment').textContent = formatINR(financials.investment);
    document.getElementById('dash-working-capital').textContent = formatINR(financials.workingCapital);
    document.getElementById('dash-running-capital').textContent = formatINR(financials.runningCapital);
    document.getElementById('dash-revenue').textContent = formatINR(financials.revenue);
    document.getElementById('dash-expense').textContent = formatINR(financials.expense);
    document.getElementById('dash-profit').textContent = formatINR(financials.profit);

    // Populate Global Transaction Ledger
    const tbody = document.getElementById('global-ledger-tbody');
    tbody.innerHTML = '';

    if (state.transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-secondary);">No transactions recorded yet.</td></tr>';
        return;
    }

    state.transactions.forEach(t => {
        const job = state.jobs.find(j => j.id === t.job_id);
        const jobSuffix = job ? ` (${job.title})` : '';
        const iconName = getPaymentMethodIcon(t.payment_method);
        
        const dateStr = new Date(t.date).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Parse Name and Person Name
        let displayName = t.name;
        let personSnippet = '';
        if (t.name.includes(' - By: ')) {
            const parts = t.name.split(' - By: ');
            displayName = parts[0];
            personSnippet = `<span class="person-tag" style="display: block; font-size: 11px; color: var(--text-secondary); margin-top: 2px;"><i data-lucide="user" style="width: 10px; height: 10px; display: inline-block; vertical-align: middle; margin-right: 2px;"></i>${parts[1]}</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td><strong>${displayName}</strong>${jobSuffix}${personSnippet}</td>
            <td><span class="pill ${t.type.includes('Inflow') || t.type.includes('Investment') ? 'pill-success' : 'pill-danger'}">${t.type}</span></td>
            <td><span class="method-tag" style="font-size: 11px;"><i data-lucide="${iconName}" style="width: 12px; height: 12px; vertical-align: middle; margin-right: 2px;"></i>${t.payment_method}</span></td>
            <td><span class="${t.type.includes('Inflow') || t.type.includes('Investment') ? 'success-text' : 'danger-text'}" style="font-weight: 700;">${formatINR(t.amount)}</span></td>
            <td>
                <div style="display: flex; gap: 4px;">
                    <button class="btn btn-primary" onclick="event.stopPropagation(); editTransaction('${t.id}')" style="min-height: 28px; padding: 2px 8px; font-size: 11px;">
                        <i data-lucide="pencil" style="width: 12px; height: 12px;"></i>
                    </button>
                    <button class="btn btn-danger" onclick="event.stopPropagation(); deleteTransaction('${t.id}')" style="min-height: 28px; padding: 2px 8px; font-size: 11px; background-color: var(--danger);">
                        <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
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
                    <button class="btn btn-danger" onclick="event.stopPropagation(); deleteClient('${client.id}')" style="min-height: 32px; padding: 0 10px; font-size: 12px; margin-right: 8px; background-color: var(--danger);">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
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

window.deleteClient = async function(clientId) {
    if (confirm("Are you sure you want to delete this client? All projects and brand assets under this client will be permanently removed.")) {
        try {
            const { error } = await supabaseClient
                .from('clients')
                .delete()
                .eq('id', clientId);
            if (error) throw error;
            showToast('Client deleted successfully', 'danger');
            await refreshAllData();
        } catch (e) {
            console.error("Delete client error:", e);
            alert("Error deleting client: " + e.message);
        }
    }
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
            <td><span style="color: var(--success); font-weight: 700; font-variant-numeric: tabular-nums;">${formatINR(job.budget - job.expense)}</span></td>
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
                <div class="step-details">
                    <div class="step-name-row" onclick="toggleStep(${idx})">
                        <span class="step-name">${step.name}</span>
                    </div>
                    <span class="step-desc" onclick="toggleStep(${idx})">${step.description || ''}</span>
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
        const clientNameEl = document.getElementById('overview-client-name');
        if (clientNameEl) clientNameEl.textContent = client.name;
        
        const startDateEl = document.getElementById('overview-start-date');
        if (startDateEl) {
            const dateOpt = { day: '2-digit', month: 'short', year: 'numeric' };
            startDateEl.textContent = client.start_date ? new Date(client.start_date).toLocaleDateString('en-IN', dateOpt) : 'Not set';
        }
        
        const deadlineEl = document.getElementById('overview-deadline');
        if (deadlineEl) {
            const dateOpt = { day: '2-digit', month: 'short', year: 'numeric' };
            deadlineEl.textContent = client.deadline ? new Date(client.deadline).toLocaleDateString('en-IN', dateOpt) : 'Not set';
        }
        
        const clientJobs = state.jobs.filter(j => j.client_id === client.id);
        let clientStatus = 'Completed';
        if (clientJobs.length > 0) {
            clientStatus = clientJobs.some(j => j.status !== 'Payment') ? 'On Track' : 'Completed';
        } else {
            clientStatus = 'On Track';
        }
        const statusEl = document.getElementById('overview-status');
        if (statusEl) {
            statusEl.textContent = clientStatus;
            statusEl.className = `pill ${clientStatus === 'On Track' ? 'pill-success' : 'pill-neutral'}`;
        }

        // Dynamic Calculations from Transactions belonging to this Job
        console.log("Active Job ID:", job.id, "All Transactions:", state.transactions);
        const jobTransactions = state.transactions.filter(t => t.job_id === job.id);
        console.log("Filtered Job Transactions:", jobTransactions);
        const inflowVal = jobTransactions.filter(t => t.type === 'Job Inflow').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        const actualExpenseVal = jobTransactions.filter(t => t.type === 'Job Expense').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

        // Sidebar Quotation Stats
        const quotation = parseFloat(job.budget) || 0;
        const estExpense = parseFloat(job.expense) || 0;
        document.getElementById('sidebar-est-budget').textContent = formatINR(quotation);
        document.getElementById('sidebar-est-expense').textContent = formatINR(estExpense);
        document.getElementById('sidebar-est-profit').textContent = formatINR(quotation - estExpense);

        // 1. INFLOW (IN) - Paid by Client vs Total Quotation
        const inflowPercent = Math.min(Math.round((inflowVal / (quotation || 1)) * 100), 100);
        document.getElementById('inflow-value').textContent = formatINR(inflowVal);
        document.getElementById('inflow-limit-value').textContent = `/ ${formatINR(quotation)}`;
        document.getElementById('inflow-progress-bar').style.width = `${inflowPercent}%`;
        document.getElementById('inflow-percent').textContent = `${inflowPercent}% collected`;

        // 2. OUTFLOW (OUT) - Expenses incurred vs Estimated Expense limit
        const expensePercent = Math.min(Math.round((actualExpenseVal / (estExpense || 1)) * 100), 100);
        document.getElementById('expense-value').textContent = formatINR(actualExpenseVal);
        document.getElementById('expense-limit-value').textContent = `/ ${formatINR(estExpense)}`;
        document.getElementById('expense-progress-bar').style.width = `${expensePercent}%`;
        document.getElementById('expense-percent').textContent = `${expensePercent}% utilized`;

        // Actual Net Profit = Inflow - Outflow
        const actualNetProfit = inflowVal - actualExpenseVal;
        const profitEl = document.getElementById('actual-net-profit');
        profitEl.textContent = formatINR(actualNetProfit);
        profitEl.className = actualNetProfit >= 0 ? 'value success-text font-bold' : 'value danger-text font-bold';

        // Render Job-specific Ledger History List
        const jobLedger = document.getElementById('job-ledger-history');
        jobLedger.innerHTML = '';
        if (jobTransactions.length === 0) {
            jobLedger.innerHTML = '<div style="font-size: 11px; color: var(--text-secondary); text-align: center; padding: 10px;">No cash transfers recorded.</div>';
        } else {
            jobTransactions.forEach(t => {
                const iconName = getPaymentMethodIcon(t.payment_method);
                const isPositive = t.type === 'Job Inflow';

                // Parse Name and Person Name
                let displayName = t.name;
                let personSnippet = '';
                if (t.name.includes(' - By: ')) {
                    const parts = t.name.split(' - By: ');
                    displayName = parts[0];
                    personSnippet = `<span class="person-tag" style="display: block; font-size: 10px; color: var(--text-secondary); margin-top: 2px;"><i data-lucide="user" style="width: 8px; height: 8px; display: inline-block; vertical-align: middle; margin-right: 2px;"></i>${parts[1]}</span>`;
                }

                const row = document.createElement('div');
                row.className = 'job-ledger-row';
                row.innerHTML = `
                    <div class="left-desc">
                        <strong>${displayName}</strong>
                        <span class="method-tag"><i data-lucide="${iconName}" style="width: 10px; height: 10px;"></i>${t.payment_method}</span>
                        ${personSnippet}
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span class="val-amt ${isPositive ? 'success-text' : 'danger-text'}">${isPositive ? '+' : '-'}${formatINR(t.amount)}</span>
                        <button class="btn btn-primary" onclick="event.stopPropagation(); editTransaction('${t.id}')" style="min-height: 24px; padding: 2px 4px; font-size: 10px; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px;">
                            <i data-lucide="pencil" style="width: 10px; height: 10px;"></i>
                        </button>
                        <button class="btn btn-danger" onclick="event.stopPropagation(); deleteTransaction('${t.id}')" style="min-height: 24px; padding: 2px 4px; font-size: 10px; background-color: var(--danger); width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px;">
                            <i data-lucide="trash-2" style="width: 10px; height: 10px;"></i>
                        </button>
                    </div>
                `;
                jobLedger.appendChild(row);
            });
        }
    }
    lucide.createIcons();
}

window.updateStepExpense = async function(stepIndex, val) {
    if (!state.activeJobId) return;
    const job = state.jobs.find(j => j.id === state.activeJobId);
    if (!job) return;

    const steps = [...job.milestone_steps];
    steps[stepIndex].expense = parseFloat(val) || 0;

    const newExpense = steps.reduce((sum, s) => sum + (parseFloat(s.expense) || 0), 0);

    // Auto-recalculate estimated profit
    let newProfit = parseFloat(job.budget || 0) - newExpense;

    try {
        const { error } = await supabaseClient
            .from('jobs')
            .update({ milestone_steps: steps, expense: newExpense, profit: newProfit })
            .eq('id', job.id);
        if (error) throw error;
    } catch (e) {
        console.error("Update step expense failed", e);
    }
    await refreshAllData();
};

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
        showToast('Milestone status updated', 'success');
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
        showToast('Milestone step deleted', 'danger');
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

    // Create Job Modal Triggers
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
            amount_given: 0.00,
            status: 'Initial Consultation',
            date_issued: new Date().toISOString(),
            milestone_steps: [
                {"name": "Initial Consultation", "completed": true, "timestamp": new Date().toISOString(), "description": "Client meeting to discuss requirements and scope.", "expense": 0},
                {"name": "Design Drafts Submitted", "completed": false, "timestamp": null, "description": "First round of concepts sent for review.", "expense": 0},
                {"name": "Client Revisions", "completed": false, "timestamp": null, "description": "Implement feedback from review sessions.", "expense": 0},
                {"name": "Payment", "completed": false, "timestamp": null, "description": "Final invoice generation and payment confirmation.", "expense": 0}
            ]
        };

        try {
            const { error } = await supabaseClient
                .from('jobs')
                .insert([newJob]);
            if (error) throw error;
            showToast('Job created successfully', 'success');
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
            description: description,
            expense: 0
        };

        const insertIndex = Math.max(steps.length - 1, 0);
        steps.splice(insertIndex, 0, newStepObj);

        try {
            const { error } = await supabaseClient
                .from('jobs')
                .update({ milestone_steps: steps })
                .eq('id', job.id);
            if (error) throw error;
            showToast('Milestone step added', 'success');
        } catch (err) {
            console.error("Add step error:", err);
        }

        document.getElementById('modal-add-step').classList.add('hidden');
        document.getElementById('form-add-step').reset();
        await refreshAllData();
    });

    // Open Unified Transaction Modals
    document.getElementById('btn-add-investment-dash').addEventListener('click', () => {
        openTransactionModal('Investment', 'Investment Capital Injection', null);
    });

    document.getElementById('btn-add-utility-dash').addEventListener('click', () => {
        openTransactionModal('Other Expense', 'Utility / General Expense', null);
    });

    document.getElementById('btn-record-inflow').addEventListener('click', () => {
        if (!state.activeJobId) return;
        const job = state.jobs.find(j => j.id === state.activeJobId);
        openTransactionModal('Job Inflow', `Client Payment received for ${job ? job.title : 'Project'}`, state.activeJobId);
    });

    document.getElementById('btn-record-outflow').addEventListener('click', () => {
        if (!state.activeJobId) return;
        const job = state.jobs.find(j => j.id === state.activeJobId);
        openTransactionModal('Job Expense', `Expense paid for ${job ? job.title : 'Project'}`, state.activeJobId);
    });

    document.getElementById('btn-close-transaction-modal').addEventListener('click', () => {
        document.getElementById('modal-add-transaction').classList.add('hidden');
    });

    // Unified Transaction Creation Handler
    document.getElementById('form-add-transaction').addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.getElementById('transaction-type').value;
        const jobId = document.getElementById('transaction-job-id').value || null;
        const desc = document.getElementById('transaction-name').value;
        const person = document.getElementById('transaction-person').value || '';
        const name = person ? `${desc} - By: ${person}` : desc;
        const amount = parseFloat(document.getElementById('transaction-amount').value) || 0;
        
        const methodOption = document.querySelector('input[name="payment_method"]:checked');
        const method = methodOption ? methodOption.value : 'Cash';
        
        const customDateVal = document.getElementById('transaction-date').value;
        const date = customDateVal ? new Date(customDateVal).toISOString() : new Date().toISOString();

        const newTx = {
            id: getUUID(),
            job_id: jobId,
            type,
            name,
            amount,
            payment_method: method,
            date
        };

        const form = document.getElementById('form-add-transaction');
        const editingId = form.dataset.editingId;

        try {
            if (editingId) {
                const { error } = await supabaseClient
                    .from('transactions')
                    .update({
                        job_id: jobId,
                        type,
                        name,
                        amount,
                        payment_method: method,
                        date
                    })
                    .eq('id', editingId);
                if (error) throw error;
                delete form.dataset.editingId;
                showToast('Transaction updated successfully', 'success');
            } else {
                const { error } = await supabaseClient
                    .from('transactions')
                    .insert([newTx]);
                if (error) throw error;
                showToast('Transaction recorded successfully', 'success');
            }
        } catch (err) {
            console.error("Save transaction error:", err);
            alert("Error saving transaction: " + err.message);
        }

        document.getElementById('modal-add-transaction').classList.add('hidden');
        form.reset();
        delete form.dataset.editingId;
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
                showToast('Brand photo uploaded successfully', 'success');
            } catch (err) {
                console.error("Gallery upload error:", err);
                alert("Upload failed: " + err.message);
            }

            document.getElementById('form-upload-gallery').reset();
            await refreshAllData();
        }
    });

    // Delete Active Job click listener
    document.getElementById('btn-delete-active-job').addEventListener('click', async () => {
        if (!state.activeJobId) return;
        if (confirm("Are you sure you want to delete this project/job? All progress and transactions will be lost.")) {
            try {
                const { error } = await supabaseClient
                    .from('jobs')
                    .delete()
                    .eq('id', state.activeJobId);
                if (error) throw error;
                showToast('Job/Project deleted successfully', 'danger');
                state.activeJobId = null;
                await refreshAllData();
            } catch (e) {
                console.error("Delete job error:", e);
                alert("Error deleting job: " + e.message);
            }
        }
    });
}

function openTransactionModal(type, title, jobId) {
    const form = document.getElementById('form-add-transaction');
    delete form.dataset.editingId;
    document.getElementById('transaction-type').value = type;
    document.getElementById('transaction-job-id').value = jobId || '';
    document.getElementById('transaction-modal-title').textContent = title;
    document.getElementById('transaction-name').value = type === 'Investment' ? 'Investment Inflow' : '';
    document.getElementById('transaction-person').value = '';
    document.getElementById('transaction-amount').value = '';
    document.getElementById('transaction-date').value = '';
    document.getElementById('modal-add-transaction').classList.remove('hidden');
}

window.deleteTransaction = async function(txId) {
    if (confirm("Are you sure you want to delete this transaction record?")) {
        try {
            const { error } = await supabaseClient
                .from('transactions')
                .delete()
                .eq('id', txId);
            if (error) throw error;
            showToast('Transaction record deleted', 'danger');
            await refreshAllData();
        } catch (e) {
            console.error("Delete transaction error:", e);
            alert("Error deleting transaction: " + e.message);
        }
    }
};

window.editTransaction = function(txId) {
    const tx = state.transactions.find(t => t.id === txId);
    if (!tx) return;

    document.getElementById('transaction-type').value = tx.type;
    document.getElementById('transaction-job-id').value = tx.job_id || '';
    document.getElementById('transaction-modal-title').textContent = `Edit Transaction: ${tx.type}`;

    let displayName = tx.name;
    let personName = '';
    if (tx.name.includes(' - By: ')) {
        const parts = tx.name.split(' - By: ');
        displayName = parts[0];
        personName = parts[1];
    }

    document.getElementById('transaction-name').value = displayName;
    document.getElementById('transaction-person').value = personName;
    document.getElementById('transaction-amount').value = tx.amount;

    const radios = document.getElementsByName('payment_method');
    radios.forEach(r => {
        if (r.value === tx.payment_method) r.checked = true;
    });

    const form = document.getElementById('form-add-transaction');
    form.dataset.editingId = txId;

    document.getElementById('modal-add-transaction').classList.remove('hidden');
};
