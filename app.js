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
    activeJobId: null,
    ledgerTypeFilter: 'all',
    ledgerDateFilter: 'all',
    ledgerMethodFilter: 'all'
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
        
        // Auto-purge soft-deleted transactions older than 30 days
        const now = new Date();
        const expiredTxs = state.transactions.filter(t => {
            if (!t.name.startsWith('[DELETED]')) return false;
            try {
                const jsonStr = t.name.replace('[DELETED] ', '');
                const meta = JSON.parse(jsonStr);
                const diffTime = Math.abs(now - new Date(meta.deletedAt));
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                return diffDays >= 30;
            } catch(e) {
                return false;
            }
        });
        if (expiredTxs.length > 0) {
            for (const tx of expiredTxs) {
                await supabaseClient.from('transactions').delete().eq('id', tx.id);
            }
            await fetchTransactions();
        }
        
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
    // Exclude soft-deleted transactions from totals
    const activeTxs = state.transactions.filter(t => !t.name.startsWith('[DELETED]'));

    // 1. Revenue: sum of all active Job Inflow transactions
    const totalRevenue = activeTxs
        .filter(t => t.type === 'Job Inflow')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    // 2. Working Capital (Job Expense): sum of all active Job Expense transactions
    const workingCapital = activeTxs
        .filter(t => t.type === 'Job Expense')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    // 3. Expense (Utility Expense): sum of all active Other Expense transactions
    const totalExpense = activeTxs
        .filter(t => t.type === 'Other Expense')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    // 4. Net Profit = Revenue - Working Capital - Expense
    const netProfit = totalRevenue - workingCapital - totalExpense;

    // 5. Investment: sum of all active Investment transactions
    const investment = activeTxs
        .filter(t => t.type === 'Investment')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    // 6. Running Capital = Investment + Net Profit
    const runningCapital = investment + netProfit;

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

// Helper to compress and convert images to lightweight Base64 data URLs
function compressImage(file, maxWidth = 800, quality = 0.75) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            return fileToBase64(file).then(resolve).catch(reject);
        }
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = error => reject(error);
        };
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

    // Exclude soft-deleted transactions from the main list
    let activeTransactions = state.transactions.filter(t => !t.name.startsWith('[DELETED]'));
    
    // Apply type filter
    if (state.ledgerTypeFilter !== 'all') {
        activeTransactions = activeTransactions.filter(t => t.type === state.ledgerTypeFilter);
    }

    // Apply date filter
    if (state.ledgerDateFilter !== 'all') {
        const now = new Date();
        if (state.ledgerDateFilter === 'today') {
            const todayStr = now.toDateString();
            activeTransactions = activeTransactions.filter(t => new Date(t.date).toDateString() === todayStr);
        } else if (state.ledgerDateFilter === 'this-month') {
            const curMonth = now.getMonth();
            const curYear = now.getFullYear();
            activeTransactions = activeTransactions.filter(t => {
                const d = new Date(t.date);
                return d.getMonth() === curMonth && d.getFullYear() === curYear;
            });
        } else if (state.ledgerDateFilter === 'last-30-days') {
            activeTransactions = activeTransactions.filter(t => {
                const diff = Math.abs(now - new Date(t.date));
                const diffDays = diff / (1000 * 60 * 60 * 24);
                return diffDays <= 30;
            });
        }
    }

    // Apply method filter
    if (state.ledgerMethodFilter !== 'all') {
        activeTransactions = activeTransactions.filter(t => t.payment_method === state.ledgerMethodFilter);
    }

    if (activeTransactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-secondary);">No transactions match the selected filters.</td></tr>';
    } else {
        activeTransactions.forEach(t => {
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

    // Populate Recycle Bin
    const recycleTbody = document.getElementById('recycle-bin-tbody');
    recycleTbody.innerHTML = '';
    
    const deletedTransactions = state.transactions.filter(t => t.name.startsWith('[DELETED]'));
    
    if (deletedTransactions.length === 0) {
        recycleTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-secondary);">Recycle Bin is empty.</td></tr>';
    } else {
        deletedTransactions.forEach(t => {
            let originalName = t.name;
            let originalType = t.type;
            let deletedAt = new Date().toISOString();
            let reason = '';
            
            try {
                const jsonStr = t.name.replace('[DELETED] ', '');
                const meta = JSON.parse(jsonStr);
                originalName = meta.originalName;
                originalType = meta.originalType || t.type;
                deletedAt = meta.deletedAt;
                reason = meta.reason;
            } catch(e) {
                // Fallback if not valid JSON
            }

            const job = state.jobs.find(j => j.id === t.job_id);
            const jobSuffix = job ? ` (${job.title})` : '';

            const dateDeletedStr = new Date(deletedAt).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
            });

            // Calculate days left (30 days total)
            const diffTime = Math.abs(new Date() - new Date(deletedAt));
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            const daysLeft = Math.max(30 - diffDays, 0);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${dateDeletedStr}</td>
                <td><strong>${originalName}</strong>${jobSuffix}</td>
                <td><span class="pill ${originalType.includes('Inflow') || originalType.includes('Investment') ? 'pill-success' : 'pill-danger'}">${originalType}</span></td>
                <td style="color: var(--text-secondary); font-style: italic;">"${reason || 'No reason specified'}"</td>
                <td><span class="pill ${daysLeft > 5 ? 'pill-neutral' : 'pill-danger'}" style="font-weight: 700;">${daysLeft} days left</span></td>
                <td>
                    <div style="display: flex; gap: 4px;">
                        <button class="btn btn-primary" onclick="event.stopPropagation(); restoreTransaction('${t.id}')" style="min-height: 28px; padding: 2px 8px; font-size: 11px; background-color: var(--success); border-color: var(--success);" title="Restore Entry">
                            <i data-lucide="rotate-ccw" style="width: 12px; height: 12px;"></i> Restore
                        </button>
                        <button class="btn btn-danger" onclick="event.stopPropagation(); permanentlyDeleteTransaction('${t.id}')" style="min-height: 28px; padding: 2px 8px; font-size: 11px; background-color: var(--danger);" title="Permanently Delete">
                            <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i> Purge
                        </button>
                    </div>
                </td>
            `;
            recycleTbody.appendChild(tr);
        });
    }
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

    const activeJobs = state.jobs.filter(j => j.status !== 'Completed');
    const pastJobs = state.jobs.filter(j => j.status === 'Completed');

    // Render Active Projects Section
    const activeHeader = document.createElement('div');
    activeHeader.style = "font-size: 10px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em; padding: 4px; border-bottom: 1px solid var(--border);";
    activeHeader.textContent = "Active Projects";
    list.appendChild(activeHeader);

    if (activeJobs.length === 0) {
        const placeholder = document.createElement('p');
        placeholder.style = "font-size: 11px; color: var(--text-secondary); padding: 8px; font-style: italic; margin: 0 0 12px 0;";
        placeholder.textContent = "No active projects";
        list.appendChild(placeholder);
    } else {
        activeJobs.forEach(job => {
            const client = state.clients.find(c => c.id === job.client_id);
            const item = document.createElement('div');
            item.className = `job-select-item ${state.activeJobId === job.id ? 'active' : ''}`;
            item.innerHTML = `
                <div>
                    <div class="title">${job.title}</div>
                    <div style="font-size: 11px; color: var(--text-secondary);">${client ? client.name : 'Client'}</div>
                </div>
                <span class="pill pill-warning" style="font-size: 9px; padding: 2px 4px;">${job.status}</span>
            `;
            item.addEventListener('click', () => {
                state.activeJobId = job.id;
                renderTracking();
            });
            list.appendChild(item);
        });
    }

    // Render Past Projects Section
    const pastHeader = document.createElement('div');
    pastHeader.style = "font-size: 10px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-top: 16px; margin-bottom: 8px; letter-spacing: 0.05em; padding: 4px; border-bottom: 1px solid var(--border);";
    pastHeader.textContent = "Past Projects";
    list.appendChild(pastHeader);

    if (pastJobs.length === 0) {
        const placeholder = document.createElement('p');
        placeholder.style = "font-size: 11px; color: var(--text-secondary); padding: 8px; font-style: italic; margin: 0;";
        placeholder.textContent = "No completed projects yet";
        list.appendChild(placeholder);
    } else {
        pastJobs.forEach(job => {
            const client = state.clients.find(c => c.id === job.client_id);
            const item = document.createElement('div');
            item.className = `job-select-item ${state.activeJobId === job.id ? 'active' : ''}`;
            item.style.opacity = '0.8';
            item.innerHTML = `
                <div>
                    <div class="title" style="text-decoration: line-through; color: var(--text-secondary);">${job.title}</div>
                    <div style="font-size: 11px; color: var(--text-secondary);">${client ? client.name : 'Client'}</div>
                </div>
                <span class="pill pill-success" style="font-size: 9px; padding: 2px 4px;">Completed</span>
            `;
            item.addEventListener('click', () => {
                state.activeJobId = job.id;
                renderTracking();
            });
            list.appendChild(item);
        });
    }

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

    const selectedJobId = document.getElementById('gallery-job-select').value;
    const uploadContainer = document.getElementById('gallery-upload-container');
    const downloadBtn = document.getElementById('btn-download-job-photos');

    if (selectedJobId === 'all') {
        uploadContainer.style.display = 'none';
        downloadBtn.style.display = 'none';
    } else {
        uploadContainer.style.display = 'block';
        downloadBtn.style.display = 'flex';
    }

    let filteredPhotos = state.clientPhotos;
    if (selectedJobId && selectedJobId !== 'all') {
        filteredPhotos = filteredPhotos.filter(p => {
            try {
                const parsed = JSON.parse(p.caption);
                return parsed.jobId === selectedJobId;
            } catch (e) {
                return false;
            }
        });
    }

    if (filteredPhotos.length === 0) {
        photoGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><p>No brand assets uploaded for this project yet.</p></div>';
        return;
    }

    filteredPhotos.forEach(photo => {
        const dateStr = new Date(photo.created_at).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short'
        });

        let displayName = photo.caption;
        try {
            const parsed = JSON.parse(photo.caption);
            displayName = parsed.text || '';
        } catch (e) {}

        const card = document.createElement('div');
        card.className = 'photo-card';
        card.innerHTML = `
            <img src="${photo.url}" alt="Gallery Asset">
            <div class="caption">${displayName || 'Brand Asset'}</div>
            <div class="date" style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                <span>Uploaded ${dateStr}</span>
                <button class="btn btn-danger" onclick="event.stopPropagation(); deleteGalleryPhoto('${photo.id}')" style="min-height: 20px; padding: 2px 4px; font-size: 9px; background-color: var(--danger); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;">
                    <i data-lucide="trash-2" style="width: 10px; height: 10px;"></i>
                </button>
            </div>
        `;
        photoGrid.appendChild(card);
    });
    lucide.createIcons();
}

function populateFormDropdowns() {
    const gallerySelect = document.getElementById('gallery-job-select');
    const selectedJobId = gallerySelect.value;
    gallerySelect.innerHTML = '<option value="all">All Projects / Jobs</option>';

    state.jobs.forEach(job => {
        const client = state.clients.find(c => c.id === job.client_id);
        const option = document.createElement('option');
        option.value = job.id;
        option.textContent = `${client ? client.name : 'Unknown Client'} - ${job.title}`;
        gallerySelect.appendChild(option);
    });
    if (selectedJobId) gallerySelect.value = selectedJobId;

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
            logoBase64 = await compressImage(logoFile, 400, 0.8);
        }

        const clientDataNoStatus = {
            id: getUUID(),
            name,
            type,
            logo: logoBase64,
            created_at: new Date().toISOString()
        };

        const clientDataWithStatus = {
            id: getUUID(),
            name,
            type,
            status: 'Active',
            logo: logoBase64,
            created_at: new Date().toISOString()
        };

        try {
            let { error } = await supabaseClient
                .from('clients')
                .insert([clientDataNoStatus]);
            
            if (error && error.message && error.message.includes('status')) {
                const retryRes = await supabaseClient
                    .from('clients')
                    .insert([clientDataWithStatus]);
                error = retryRes.error;
            }

            if (error) throw error;
            showToast('Client created successfully', 'success');
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

    document.getElementById('gallery-job-select').addEventListener('change', () => {
        renderGallery();
    });

    // Photo Upload
    document.getElementById('form-upload-gallery').addEventListener('submit', async (e) => {
        e.preventDefault();
        const jobId = document.getElementById('gallery-job-select').value;
        const captionText = document.getElementById('gallery-caption').value;
        const file = document.getElementById('gallery-file').files[0];

        if (!jobId || jobId === 'all') {
            alert('Please select a specific Job to upload the photo under.');
            return;
        }

        const job = state.jobs.find(j => j.id === jobId);
        if (!job) {
            alert('Selected job was not found.');
            return;
        }

        if (file) {
            const base64Photo = await compressImage(file, 800, 0.75);
            
            // Encode jobId inside the caption field to bypass database schema limits
            const captionJsonString = JSON.stringify({ jobId: jobId, text: captionText });

            const newPhotoObj = {
                id: getUUID(),
                client_id: job.client_id, // Satisfy foreign key constraint
                url: base64Photo,
                caption: captionJsonString,
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

    // Download Job Photos (Printable Work Report) Listener
    document.getElementById('btn-download-job-photos').addEventListener('click', () => {
        const jobId = document.getElementById('gallery-job-select').value;
        if (!jobId || jobId === 'all') return;

        const job = state.jobs.find(j => j.id === jobId);
        if (!job) return;

        const client = state.clients.find(c => c.id === job.client_id);
        const photos = state.clientPhotos.filter(p => {
            try {
                const parsed = JSON.parse(p.caption);
                return parsed.jobId === jobId;
            } catch (e) {
                return false;
            }
        });

        // Generate dynamic printable window HTML
        const printWindow = window.open('', '_blank');
        
        let photosHtml = '';
        photos.forEach(p => {
            let captionText = p.caption;
            try {
                captionText = JSON.parse(p.caption).text;
            } catch(e) {}
            photosHtml += `
                <div class="photo-item">
                    <img src="${p.url}" />
                    <p class="photo-caption">${captionText || 'Work Progress Photo'}</p>
                </div>
            `;
        });

        const jobTransactions = state.transactions.filter(t => t.job_id === jobId);
        const inflowVal = jobTransactions.filter(t => t.type === 'Job Inflow').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        const expenseVal = jobTransactions.filter(t => t.type === 'Job Expense').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

        printWindow.document.write(`
            <html>
            <head>
                <title>Work Report - ${job.title}</title>
                <style>
                    body {
                        font-family: system-ui, -apple-system, sans-serif;
                        color: #111827;
                        margin: 40px;
                        padding: 0;
                        background-color: #FFFFFF;
                    }
                    .header-bar {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 2px solid #E5E7EB;
                        padding-bottom: 20px;
                        margin-bottom: 30px;
                    }
                    .brand-name {
                        font-size: 20px;
                        font-weight: 800;
                        color: #FF6B00;
                        letter-spacing: 0.05em;
                    }
                    .logo-img {
                        height: 48px;
                        object-fit: contain;
                        border-radius: 4px;
                    }
                    .title-section h1 {
                        font-size: 24px;
                        font-weight: 700;
                        margin: 0 0 8px 0;
                        color: #1F2937;
                    }
                    .title-section p {
                        font-size: 14px;
                        color: #4B5563;
                        margin: 0;
                    }
                    .details-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 20px;
                        margin-bottom: 40px;
                        background: #F9FAFB;
                        border: 1px solid #E5E7EB;
                        border-radius: 8px;
                        padding: 20px;
                    }
                    .detail-item {
                        font-size: 14px;
                        color: #1F2937;
                    }
                    .detail-item strong {
                        display: block;
                        font-size: 11px;
                        color: #6B7280;
                        text-transform: uppercase;
                        margin-bottom: 4px;
                        letter-spacing: 0.05em;
                    }
                    .photos-section {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 24px;
                    }
                    .photo-item {
                        border: 1px solid #E5E7EB;
                        border-radius: 8px;
                        overflow: hidden;
                        background: #FFFFFF;
                        page-break-inside: avoid;
                    }
                    .photo-item img {
                        width: 100%;
                        height: 260px;
                        object-fit: cover;
                        display: block;
                    }
                    .photo-caption {
                        padding: 12px;
                        font-size: 13px;
                        font-weight: 600;
                        margin: 0;
                        background: #F9FAFB;
                        border-top: 1px solid #E5E7EB;
                        color: #374151;
                    }
                    .print-btn-container {
                        margin-bottom: 30px;
                        text-align: right;
                    }
                    .btn-print {
                        background-color: #FF6B00;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        font-size: 14px;
                        font-weight: 700;
                        border-radius: 6px;
                        cursor: pointer;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    @media print {
                        .print-btn-container {
                            display: none;
                        }
                        body {
                            margin: 20px;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="print-btn-container">
                    <button class="btn-print" onclick="window.print()">Print / Save as PDF</button>
                </div>
                <div class="header-bar">
                    <div>
                        <span class="brand-name">ROYAL BRANDWORKS</span>
                    </div>
                    <img class="logo-img" src="${window.location.origin}/logo.jpg" onerror="this.style.display='none'" />
                </div>
                <div class="title-section">
                    <h1>Work Completion &amp; Progress Report</h1>
                    <p>Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                </div>
                <div style="margin-top: 20px;"></div>
                <div class="details-grid">
                    <div class="detail-item">
                        <strong>Client Name</strong>
                        ${client ? client.name : 'Unknown Client'}
                    </div>
                    <div class="detail-item">
                        <strong>Project / Job Title</strong>
                        ${job.title}
                    </div>
                    <div class="detail-item">
                        <strong>Quotation Value</strong>
                        ${formatINR(job.budget)}
                    </div>
                    <div class="detail-item">
                        <strong>Current Status</strong>
                        ${job.status}
                    </div>
                    <div class="detail-item">
                        <strong>Client Payments (IN)</strong>
                        ${formatINR(inflowVal)}
                    </div>
                    <div class="detail-item">
                        <strong>Job Expenses (OUT)</strong>
                        ${formatINR(expenseVal)}
                    </div>
                </div>
                <h2 style="font-size: 18px; border-bottom: 1px solid #E5E7EB; padding-bottom: 8px; margin-bottom: 20px; color: #1F2937;">Project Gallery &amp; Proof of Work</h2>
                <div class="photos-section">
                    ${photosHtml || '<p style="grid-column: 1/-1; color: #6B7280; font-size: 14px;">No photos uploaded for this job yet.</p>'}
                </div>
            </body>
            </html>
        `);
        printWindow.document.close();
    });

    // Dashboard ledger type filter dropdown
    document.getElementById('ledger-type-filter').addEventListener('change', () => {
        state.ledgerTypeFilter = document.getElementById('ledger-type-filter').value;
        renderDashboard();
    });

    // Dashboard ledger date filter dropdown
    document.getElementById('ledger-date-filter').addEventListener('change', () => {
        state.ledgerDateFilter = document.getElementById('ledger-date-filter').value;
        renderDashboard();
    });

    // Dashboard ledger method filter dropdown
    document.getElementById('ledger-method-filter').addEventListener('change', () => {
        state.ledgerMethodFilter = document.getElementById('ledger-method-filter').value;
        renderDashboard();
    });

    // Complete active job button click listener
    document.getElementById('btn-complete-active-job').addEventListener('click', async () => {
        if (!state.activeJobId) return;
        if (confirm("Are you sure you want to mark this project/job as completed?")) {
            try {
                // Find active job
                const job = state.jobs.find(j => j.id === state.activeJobId);
                if (!job) return;

                // Make all steps completed
                const steps = (job.milestone_steps || []).map(s => ({
                    ...s,
                    completed: true,
                    timestamp: s.timestamp || new Date().toISOString()
                }));

                const { error } = await supabaseClient
                    .from('jobs')
                    .update({ status: 'Completed', milestone_steps: steps })
                    .eq('id', state.activeJobId);

                if (error) throw error;
                showToast('Project completed successfully', 'success');
                await refreshAllData();
            } catch (e) {
                console.error("Complete job error:", e);
                alert("Error completing job: " + e.message);
            }
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
    const tx = state.transactions.find(t => t.id === txId);
    if (!tx) return;

    let cleanName = tx.name;
    if (tx.name.includes(' - By: ')) {
        cleanName = tx.name.split(' - By: ')[0];
    }

    const reason = prompt(`Please enter the reason for deleting the transaction: "${cleanName}"`);
    if (reason === null) return; // Cancelled
    
    if (!reason.trim()) {
        alert("Deletion cancelled. A reason is required to move an entry to the Recycle Bin.");
        return;
    }

    try {
        const deletionMeta = `[DELETED] ` + JSON.stringify({
            originalName: tx.name,
            originalType: tx.type,
            deletedAt: new Date().toISOString(),
            reason: reason.trim()
        });

        const { error } = await supabaseClient
            .from('transactions')
            .update({
                name: deletionMeta
            })
            .eq('id', txId);

        if (error) throw error;
        showToast('Transaction moved to Recycle Bin', 'danger');
        await refreshAllData();
    } catch (e) {
        console.error("Soft delete transaction error:", e);
        alert("Error deleting transaction: " + e.message);
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

window.restoreTransaction = async function(txId) {
    const tx = state.transactions.find(t => t.id === txId);
    if (!tx) return;

    try {
        const jsonStr = tx.name.replace('[DELETED] ', '');
        const meta = JSON.parse(jsonStr);
        const { error } = await supabaseClient
            .from('transactions')
            .update({
                name: meta.originalName
            })
            .eq('id', txId);

        if (error) throw error;
        showToast('Transaction restored successfully', 'success');
        await refreshAllData();
    } catch (e) {
        console.error("Restore transaction error:", e);
        alert("Error restoring transaction: " + e.message);
    }
};

window.permanentlyDeleteTransaction = async function(txId) {
    if (confirm("Are you sure you want to PERMANENTLY delete this transaction? This action is irreversible.")) {
        try {
            const { error } = await supabaseClient
                .from('transactions')
                .delete()
                .eq('id', txId);
            if (error) throw error;
            showToast('Transaction permanently deleted', 'danger');
            await refreshAllData();
        } catch (e) {
            console.error("Permanent delete transaction error:", e);
            alert("Error deleting transaction: " + e.message);
        }
    }
};

window.deleteGalleryPhoto = async function(photoId) {
    if (confirm("Are you sure you want to delete this brand photo?")) {
        try {
            const { error } = await supabaseClient
                .from('client_photos')
                .delete()
                .eq('id', photoId);
            if (error) throw error;
            showToast('Photo deleted successfully', 'danger');
            await refreshAllData();
        } catch (e) {
            console.error("Delete photo error:", e);
            alert("Error deleting photo: " + e.message);
        }
    }
};
