// Initialize Dexie database
const db = new Dexie('ProgramClinicDB');
window.db = db;

// Define database schema
db.version(4).stores({
    patients: '++id, surname1, surname2, name, document, birthday, gender, mobile',
    records: '++id, patientId, date, motive, diagnosis',
    appointments: '++id, patientId, date, time, status',
    quotations: '++id, patientId, patientName, date, total, items',
    prescriptionTemplates: '++id, procedure, diagnosis, medicaments'
});

// Encryption Utilities (AES-GCM)
const encryptionKeyName = 'clinic_master_key';

async function getEncryptionKey() {
    let keyStr = localStorage.getItem(encryptionKeyName);
    if (!keyStr) {
        // Generate a random 32-character key if not exists
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        keyStr = btoa(String.fromCharCode.apply(null, array));
        localStorage.setItem(encryptionKeyName, keyStr);
    }
    const encoder = new TextEncoder();
    const keyData = encoder.encode(keyStr.padEnd(32, '0').substring(0, 32));
    return crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptData(text) {
    if (!text) return '';
    try {
        const key = await getEncryptionKey();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        return btoa(String.fromCharCode.apply(null, combined));
    } catch (e) { return text; }
}

async function decryptData(encryptedData) {
    if (!encryptedData) return '';
    try {
        const key = await getEncryptionKey();
        const { iv, content } = JSON.parse(encryptedData);
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(iv) },
            key,
            new Uint8Array(content)
        );
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error("Error al descifrar:", e);
        return '[Error de Cifrado]';
    }
}
window.decryptData = decryptData;

// Global state for navigation
const currentState = {
    currentView: 'dashboard',
    selectedPatientId: null
};

// Firebase State
let firebaseApp = null;
let auth = null;
let db_fs = null; // Firestore
let currentUser = null;

// DOM Elements
const mainView = document.getElementById('main-view');
const viewTitle = document.getElementById('view-title');
const navLinks = document.querySelectorAll('.nav-links li');
const statusDot = document.querySelector('.dot');
const statusText = document.querySelector('.status-text');

async function seedPrescriptionTemplates() {
    const count = await db.prescriptionTemplates.count();
    if (count > 0) return;

    const templates = [
        {
            procedure: 'Exodoncia Simple / Cirugía Oral',
            diagnosis: 'Estado post-quirúrgico por exodoncia. Ausencia de complicaciones inmediatas.',
            medicaments: '1. Ibuprofeno 600mg: Tomar 1 tableta cada 6 horas por 3 días.\n2. Acetaminofén 500mg: Tomar 1 tableta cada 6 horas (en caso de dolor persistente).\n3. Amoxicilina 500mg: Tomar 1 cápsula cada 8 horas por 7 días (Solo si hay infección previa).'
        },
        {
            procedure: 'Endodoncia (Tratamiento de Conductos)',
            diagnosis: 'Pulpitis irreversible o necrosis pulpar. Fase de post-instrumentación.',
            medicaments: '1. Naproxeno 500mg: Tomar 1 tableta cada 12 horas por 3 días.\n2. Dexametasona 4mg: Tomar 1 tableta única vez (para inflamación severa).\n3. Enjuague con Clorhexidina 0.12%: Realizar enjuagues por 30 segundos, 2 veces al día.'
        },
        {
            procedure: 'Periodoncia (Raspaje y Alisado)',
            diagnosis: 'Gingivitis crónica o Periodontitis. Post-tratamiento periodontal.',
            medicaments: '1. Enjuague con Clorhexidina 0.12%: Realizar enjuagues cada 12 horas por 7 días.\n2. Acetaminofén 500mg: Tomar 1 tableta cada 6 horas en caso de molestia.'
        },
        {
            procedure: 'Urgencia por Absceso Dental',
            diagnosis: 'Absceso periapical agudo con compromiso sistémico leve.',
            medicaments: '1. Amoxicilina + Ácido Clavulánico 875/125mg: Tomar 1 tableta cada 12 horas por 7 días.\n2. Ketorolaco 10mg: Tomar 1 tableta cada 8 horas (máximo por 2 días).'
        },
        {
            procedure: 'Blanqueamiento Dental',
            diagnosis: 'Sensibilidad dentinaria post-tratamiento de aclaramiento dental.',
            medicaments: '1. Sensodyne o crema desensibilizante: Aplicar en la zona y no enjuagar.\n2. Ibuprofeno 400mg: Tomar 1 tableta si persiste la molestia.'
        }
    ];

    await db.prescriptionTemplates.bulkAdd(templates);
}

// Initialize App
async function init() {
    setupNav();
    updateOfflineStatus();
    initFirebase();
    applyTheme();
    applyClinicBranding();
    await seedPrescriptionTemplates();
    window.addEventListener('online', updateOfflineStatus);
    window.addEventListener('offline', updateOfflineStatus);
    
    // Load initial view
    renderDashboard();
    checkDailyAppointments();
    checkBackupReminder();
}

function applyTheme() {
    const theme = localStorage.getItem('theme') || 'dark';
    const primary = localStorage.getItem('primaryColor') || '#4F46E5';
    
    if (theme === 'light') document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');
    
    document.documentElement.style.setProperty('--primary', primary);
}

function applyClinicBranding() {
    const logo = localStorage.getItem('clinicLogo');
    const name = localStorage.getItem('clinicName') || 'Program Clinic';
    
    if (logo) {
        const logoContainers = document.querySelectorAll('.logo');
        logoContainers.forEach(c => {
            c.innerHTML = `<img src="${logo}" class="clinic-logo-img"> <span>${name}</span>`;
        });
    }
}

// Initialize Firebase from LocalStorage or Default
function initFirebase() {
    const defaultConfig = {
        apiKey: "AIzaSyAxue2O5BJ0Wrsxs4380ZwFKMfQ2B5Xgm4",
        authDomain: "program-clinic.firebaseapp.com",
        projectId: "program-clinic",
        storageBucket: "program-clinic.firebasestorage.app",
        messagingSenderId: "967376203535",
        appId: "1:967376203535:web:fc61bf7e2462e45d94d87a",
        measurementId: "G-9HY2GJ67V2"
    };

    let config = localStorage.getItem('firebaseConfig');
    if (!config) {
        config = JSON.stringify(defaultConfig);
        localStorage.setItem('firebaseConfig', config);
    }

    if (config) {
        try {
            const firebaseConfig = JSON.parse(config);
            if (!firebase.apps.length) {
                firebaseApp = firebase.initializeApp(firebaseConfig);
            } else {
                firebaseApp = firebase.app();
            }
            auth = firebase.auth();
            db_fs = firebase.firestore();
            
            auth.onAuthStateChanged(user => {
                currentUser = user;
                updateAuthUI();
                if (user) syncData();
            });
        } catch (e) {
            console.error("Error inicializando Firebase:", e);
        }
    }
}

function updateAuthUI() {
    const nameEl = document.getElementById('user-name');
    const avatarEl = document.getElementById('user-avatar');
    const userInfoEl = document.getElementById('session-user-info');
    const loginSection = document.getElementById('session-login-section');
    const logoutSection = document.getElementById('session-logout-section');
    if (!nameEl) return;

    if (currentUser) {
        const email = currentUser.email;
        nameEl.textContent = email.split('@')[0];
        avatarEl.textContent = email.substring(0, 2).toUpperCase();
        if (userInfoEl) userInfoEl.textContent = '✅ Sesión activa: ' + email;
        if (loginSection) loginSection.style.display = 'none';
        if (logoutSection) logoutSection.style.display = 'block';
    } else {
        nameEl.textContent = 'Sin sesión';
        avatarEl.textContent = '??';
        if (userInfoEl) userInfoEl.textContent = 'No hay sesión activa';
        if (loginSection) loginSection.style.display = 'block';
        if (logoutSection) logoutSection.style.display = 'none';
    }
}

window.toggleSessionMenu = () => {
    const dropdown = document.getElementById('session-dropdown');
    if (!dropdown) return;
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
};

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const btn = document.getElementById('user-profile-btn');
    const dropdown = document.getElementById('session-dropdown');
    if (btn && dropdown && !btn.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

window.doLogin = async (e) => {
    e.stopPropagation();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    if (!email || !password) {
        errEl.textContent = 'Por favor ingresa email y contraseña.';
        errEl.style.display = 'block';
        return;
    }
    try {
        await auth.signInWithEmailAndPassword(email, password);
        document.getElementById('session-dropdown').style.display = 'none';
    } catch (err) {
        errEl.textContent = 'Error: ' + (err.code === 'auth/invalid-credential' ? 'Credenciales incorrectas.' : err.message);
        errEl.style.display = 'block';
    }
};

window.doLogout = async (e) => {
    e.stopPropagation();
    await auth.signOut();
    document.getElementById('session-dropdown').style.display = 'none';
};

// Sync Logic
async function syncData() {
    if (!currentUser || !db_fs) return;
    
    updateSyncStatus('Sincronizando...');
    
    try {
        // PUSH
        const patients = await db.patients.toArray();
        for (const p of patients) {
            await db_fs.collection('users').doc(currentUser.uid).collection('patients').doc(p.id.toString()).set(p);
        }
        const records = await db.records.toArray();
        for (const r of records) {
            await db_fs.collection('users').doc(currentUser.uid).collection('records').doc(r.id.toString()).set(r);
        }

        // PULL
        const snapshotP = await db_fs.collection('users').doc(currentUser.uid).collection('patients').get();
        for (const doc of snapshotP.docs) {
            await db.patients.put(doc.data());
        }
        const snapshotR = await db_fs.collection('users').doc(currentUser.uid).collection('records').get();
        for (const doc of snapshotR.docs) {
            await db.records.put(doc.data());
        }
        
        updateSyncStatus('Sincronizado');
    } catch (e) {
        console.error("Error sincronizando:", e);
        updateSyncStatus('Error de sincronización');
    }
}

function updateSyncStatus(text) {
    const statusText = document.querySelector('.status-text');
    statusText.textContent = text;
}

// Navigation Logic
function setupNav() {
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const view = link.getAttribute('data-view');
            switchView(view);
            
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });
    });
}

function switchView(view) {
    currentState.currentView = view;
    viewTitle.textContent = view.charAt(0).toUpperCase() + view.slice(1);
    
    switch(view) {
        case 'dashboard': renderDashboard(); break;
        case 'patients': renderPatients(); break;
        case 'appointments': renderAppointments(); break;
        case 'quotations': renderQuotations(); break;
        case 'statistics':
            renderStatistics();
            break;
        case 'help':
            renderHelp();
            break;
        case 'settings':
            renderSettings();
            break;
    }
}

// Offline Status
function updateOfflineStatus() {
    if (navigator.onLine) {
        statusDot.style.background = 'var(--success)';
        statusDot.style.boxShadow = '0 0 10px var(--success)';
        statusText.textContent = 'Online';
    } else {
        statusDot.style.background = 'var(--danger)';
        statusDot.style.boxShadow = '0 0 10px var(--danger)';
        statusText.textContent = 'Offline (Guardando localmente)';
    }
}

// Rendering Functions
async function renderDashboard() {
    const patients = await db.patients.toArray();
    const records = await db.records.toArray();
    const quotations = await db.quotations.toArray();
    const today = new Date().toISOString().split('T')[0];
    const todayAppointments = await db.appointments.where('date').equals(today).toArray();
    
    const totalEarnings = quotations.reduce((acc, q) => acc + (q.total || 0), 0);

    mainView.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
            <h2>Dashboard</h2>
            <div style="display: flex; gap: 1rem; align-items: center;">
                <div style="position: relative; width: 300px;">
                    <i data-lucide="search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 16px; color: var(--text-muted);"></i>
                    <input type="text" placeholder="Buscar paciente..." onkeyup="if(event.key==='Enter') renderPatients(this.value)" style="width: 100%; padding: 0.6rem 0.6rem 0.6rem 2.2rem; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text);">
                </div>
                <button class="btn" style="background: var(--primary); color: white;" onclick="generateMonthlyReport()">📊 Generar Reporte Mensual</button>
            </div>
        </div>
        <div class="stats-grid">
            <div class="stat-card" style="border-left: 4px solid #6366f1;">
                <div>
                    <span class="label">Total Pacientes</span>
                    <span class="value">${patients.length}</span>
                </div>
                <i data-lucide="users" style="color: #6366f1;"></i>
            </div>
            <div class="stat-card" style="border-left: 4px solid #10b981;">
                <div>
                    <span class="label">Citas de Hoy</span>
                    <span class="value">${todayAppointments.length}</span>
                </div>
                <i data-lucide="calendar" style="color: #10b981;"></i>
            </div>
            <div class="stat-card" style="border-left: 4px solid #f59e0b;">
                <div>
                    <span class="label">Cotizaciones</span>
                    <span class="value">${quotations.length}</span>
                </div>
                <i data-lucide="file-text" style="color: #f59e0b;"></i>
            </div>
            <div class="stat-card" style="border-left: 4px solid #8b5cf6;">
                <div>
                    <span class="label">Proyección</span>
                    <span class="value">$ ${totalEarnings.toLocaleString()}</span>
                </div>
                <i data-lucide="trending-up" style="color: #8b5cf6;"></i>
            </div>
        </div>

        <div class="card" style="margin-top: 2rem;">
            <h2>Últimos Pacientes Registrados</h2>
            <table style="width: 100%; margin-top: 1rem; border-collapse: collapse;">
                <thead>
                    <tr style="text-align: left; border-bottom: 1px solid var(--border);">
                        <th style="padding: 1rem;">Nombre</th>
                        <th style="padding: 1rem;">Cédula/ID</th>
                        <th style="padding: 1rem;">Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${patients.slice(-5).reverse().map(p => `
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 1rem;">${p.name} ${p.surname1}</td>
                            <td style="padding: 1rem;">${p.document}</td>
                            <td style="padding: 1rem;">
                                <button class="btn btn-sm" onclick="viewPatientHistory(${p.id})">Ver HC</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    lucide.createIcons();
}

async function renderHistory(id) {
    const patient = await db.patients.get(id);
    const records = await db.records.where('patientId').equals(id).toArray();

    mainView.innerHTML = `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                <h2>Historia Clínica: ${patient.name} ${patient.surname1}</h2>
                <div style="display: flex; gap: 1rem;">
                    <button class="btn" onclick="renderPatients()">← Volver</button>
                    <button class="btn btn-primary" onclick="showAddEntryForm(${id})">+ Nueva Evolución</button>
                </div>
            </div>
            
            <div class="timeline">
                ${records.length === 0 ? '<p style="text-align: center; color: var(--text-muted);">No hay registros clínicos aún.</p>' : ''}
                ${await Promise.all(records.sort((a,b) => b.date.localeCompare(a.date)).map(async r => {
                    const dReason = await decryptData(r.reason);
                    const dDiag = await decryptData(r.diagnosis);
                    const dPlan = await decryptData(r.treatmentPlan);
                    const dEvo = await decryptData(r.evolution);
                    
                    return `
                    <div class="card timeline-item" style="margin-bottom: 1.5rem; border-left: 4px solid var(--primary);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                            <div style="font-weight: bold; color: var(--primary); font-size: 1.1rem;">📅 ${r.date}</div>
                            <div style="display: flex; gap: 0.5rem;">
                                <button class="btn btn-sm" onclick="printPrescription(${r.id})" title="Imprimir Recetario"><i data-lucide="pill" style="width: 14px;"></i> Receta</button>
                                <button class="btn btn-sm btn-outline" onclick="showEditEntryForm(${r.id})" title="Editar"><i data-lucide="edit-3" style="width: 14px;"></i></button>
                                <button class="btn btn-sm btn-outline" style="color: var(--danger);" onclick="deleteRecord(${r.id})" title="Eliminar"><i data-lucide="trash" style="width: 14px;"></i></button>
                            </div>
                        </div>
                        <div class="record-content">
                            <p><strong>Motivo:</strong> ${dReason}</p>
                            <p><strong>Diagnóstico:</strong> ${dDiag}</p>
                            <p><strong>Plan de Tratamiento:</strong> ${dPlan}</p>
                            <p><strong>Evolución:</strong> ${dEvo}</p>
                        </div>
                        ${r.attachments && r.attachments.length > 0 ? `
                            <div style="margin-top: 1rem; display: flex; gap: 1rem; flex-wrap: wrap;">
                                ${r.attachments.map((img, idx) => `
                                    <div style="position: relative; width: 100px; height: 100px;">
                                        <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); cursor: pointer;" onclick="showImageModal('${img}')">
                                        <button onclick="deleteRecordImage(${r.id}, ${idx})" style="position: absolute; top: -8px; right: -8px; background: var(--danger); color: white; border: none; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2); font-size: 12px;">×</button>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                `})).then(htmls => htmls.join(''))}
            </div>
        </div>
    `;
    lucide.createIcons();
}

async function renderAppointments() {
    const appointments = await db.appointments.toArray();
    const patients = await db.patients.toArray();
    const patientMap = Object.fromEntries(patients.map(p => [p.id, `${p.name} ${p.surname1}`]));

    mainView.innerHTML = `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                <h2>Agenda de Citas</h2>
                <button class="btn btn-primary" onclick="showAddAppointmentModal()">+ Programar Cita</button>
            </div>
            <div style="display: grid; gap: 1rem;">
                ${appointments.length === 0 ? '<p style="text-align: center; color: var(--text-muted);">No hay citas programadas.</p>' : ''}
                ${appointments.sort((a,b) => a.date.localeCompare(b.date)).map(app => `
                    <div class="card" style="border-left: 4px solid var(--primary); display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 600; font-size: 1.1rem;">${patientMap[app.patientId] || 'Paciente Desconocido'}</div>
                            <div style="color: var(--text-muted); font-size: 0.9rem;">
                                <i data-lucide="calendar" style="width: 14px; vertical-align: middle;"></i> ${app.date} 
                                <i data-lucide="clock" style="width: 14px; vertical-align: middle; margin-left: 10px;"></i> ${app.time}
                            </div>
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn" style="background: #25D366; color: white;" onclick="sendAppointmentReminder(${app.id})">WhatsApp</button>
                            <button class="btn" style="background: var(--border);" onclick="addToGoogleCalendar(${app.id})">G-Calendar</button>
                            <button class="btn" style="background: var(--danger); color: white;" onclick="deleteAppointment(${app.id})">Eliminar</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    lucide.createIcons();
}

async function renderQuotations() {
    const quotations = await db.quotations.toArray();

    mainView.innerHTML = `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                <h2>Cotizaciones</h2>
                <button class="btn btn-primary" onclick="showNewQuotationModal()">+ Nueva Cotización</button>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="text-align: left; border-bottom: 1px solid var(--border);">
                        <th style="padding: 1rem;">Paciente</th>
                        <th style="padding: 1rem;">Fecha</th>
                        <th style="padding: 1rem;">Total</th>
                        <th style="padding: 1rem;">Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${quotations.length === 0 ? '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: var(--text-muted);">No hay cotizaciones registradas.</td></tr>' : ''}
                    ${quotations.map(q => `
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 1rem;">${q.patientName}</td>
                            <td style="padding: 1rem;">${q.date}</td>
                            <td style="padding: 1rem;">$ ${q.total.toLocaleString()}</td>
                            <td style="padding: 1rem;">
                                <div style="display: flex; gap: 0.5rem;">
                                    <button class="btn" onclick="printQuotation(${q.id})">Imprimir</button>
                                    <button class="btn" style="background: var(--border);" onclick="showEditQuotationModal(${q.id})">Editar</button>
                                    <button class="btn" style="background: var(--danger); color: white;" onclick="deleteQuotation(${q.id})">Eliminar</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function renderPatients(query = '') {
    let patients = await db.patients.toArray();
    
    if (query) {
        const q = query.toLowerCase();
        patients = patients.filter(p => 
            (p.name + ' ' + p.surname1 + ' ' + (p.surname2 || '')).toLowerCase().includes(q) ||
            (p.document || '').includes(q)
        );
    }

    mainView.innerHTML = `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                <h2>Listado de Pacientes</h2>
                <button class="btn btn-primary" onclick="showAddPatientModal()">+ Añadir</button>
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <div style="position: relative;">
                    <i data-lucide="search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 18px; color: var(--text-muted);"></i>
                    <input type="text" id="patient-search" value="${query}" placeholder="Buscar por nombre o documento..." 
                        oninput="filterPatients(this.value)" 
                        style="width: 100%; padding: 0.75rem 0.75rem 0.75rem 2.5rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text);">
                </div>
            </div>

            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="text-align: left; border-bottom: 1px solid var(--border);">
                        <th style="padding: 1rem;">Nombre</th>
                        <th style="padding: 1rem;">Documento</th>
                        <th style="padding: 1rem;">Celular</th>
                        <th style="padding: 1rem;">Acciones</th>
                    </tr>
                </thead>
                <tbody id="patients-table-body">
                    ${patients.length === 0 ? `<tr><td colspan="4" style="padding: 2rem; text-align: center; color: var(--text-muted);">No se encontraron pacientes.</td></tr>` : ''}
                    ${patients.map(p => `
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 1rem;">${p.surname1} ${p.name}</td>
                            <td style="padding: 1rem;">${p.document}</td>
                            <td style="padding: 1rem;">${p.mobile || 'N/A'}</td>
                            <td style="padding: 1rem;">
                                <div style="display: flex; gap: 0.5rem;">
                                    <button class="btn" onclick="viewPatientHistory(${p.id})">Ver Historia</button>
                                    <button class="btn" style="background: var(--border);" onclick="showEditPatientModal(${p.id})">Editar</button>
                                    <button class="btn" style="background: var(--danger); color: white;" onclick="deletePatient(${p.id})">Eliminar</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    lucide.createIcons();
    
    // Focus the search input and put cursor at end
    if (query) {
        const input = document.getElementById('patient-search');
        input.focus();
        input.setSelectionRange(query.length, query.length);
    }
}

window.filterPatients = (val) => {
    renderPatients(val);
};

window.renderSettings = () => {
    const config = localStorage.getItem('firebaseConfig') || '';
    const masterKey = localStorage.getItem('clinic_master_key') || 'No generada';
    const lastBackup = localStorage.getItem('lastBackupDate') || 'Nunca';
    const currentTheme = localStorage.getItem('theme') || 'dark';
    const primaryColor = localStorage.getItem('primaryColor') || '#0ea5e9';

    mainView.innerHTML = `
        <div class="card">
            <h2>Configuración del Sistema</h2>
            
            <div class="form-section">
                <h3>📍 Identidad de la Clínica</h3>
                <div class="form-grid">
                    <div class="form-group">
                        <label>Nombre de la Clínica</label>
                        <input type="text" id="set-clinic-name" value="${localStorage.getItem('clinicName') || ''}">
                    </div>
                    <div class="form-group">
                        <label>NIT / Identificación</label>
                        <input type="text" id="set-clinic-nit" value="${localStorage.getItem('clinicNIT') || ''}">
                    </div>
                </div>
                <div class="form-group" style="margin-top: 1rem;">
                    <label>Logo de la Clínica (JPG/PNG)</label>
                    <input type="file" accept="image/*" onchange="handleLogoUpload(this)">
                </div>
                <button class="btn btn-primary" onclick="saveClinicInfo()">Guardar Identidad</button>
            </div>

            <div class="form-section">
                <h3>🔒 Seguridad y Cifrado (Grado Médico)</h3>
                <div style="background: rgba(0,0,0,0.2); padding: 1.5rem; border-radius: 12px; border-left: 5px solid var(--primary); margin: 1rem 0;">
                    <p style="font-weight: 600; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                        <i data-lucide="shield-check" style="width: 20px;"></i> Protección AES-GCM Activa
                    </p>
                    <p style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 1rem;">Esta es tu llave maestra de cifrado. Úsala para recuperar tus datos si cambias de equipo.</p>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <input type="text" id="master-key-input" value="${masterKey}" readonly style="font-family: 'Courier New', monospace; background: var(--bg); font-weight: bold; flex: 1;">
                        <button class="btn" onclick="copyMasterKey()">Copiar</button>
                    </div>
                    <p style="font-size: 0.75rem; color: var(--danger); margin-top: 1rem; padding: 0.5rem; background: rgba(239, 68, 68, 0.1); border-radius: 4px;"> ⚠️ SI PIERDES ESTA LLAVE, LOS DATOS CIFRADOS NO SE PODRÁN RECUPERAR JAMÁS.</p>
                </div>
                <div class="check-item" style="margin-top: 1rem;">
                    <input type="checkbox" id="habeas-toggle" ${localStorage.getItem('habeasDataEnabled') === 'true' ? 'checked' : ''} onchange="localStorage.setItem('habeasDataEnabled', this.checked)">
                    <label>Activar Consentimiento Habeas Data (Ley 1581)</label>
                </div>
            </div>

            <div class="form-section">
                <h3>🎨 Personalización Visual</h3>
                <div style="display: flex; gap: 2rem; align-items: center; flex-wrap: wrap;">
                    <button class="btn" onclick="toggleTheme()">${currentTheme === 'dark' ? '☀️ Cambiar a Modo Claro' : '🌙 Cambiar a Modo Oscuro'}</button>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <label>Color Principal: </label>
                        <input type="color" value="${primaryColor}" onchange="setPrimaryColor(this.value)" style="width: 50px; height: 30px; padding: 0; border: none;">
                    </div>
                </div>
            </div>

            <div class="form-section">
                <h3>☁️ Sincronización en la Nube (Firebase)</h3>
                <textarea id="fb-config-input" rows="6" placeholder='{ "apiKey": "...", ... }' style="font-family: monospace;">${config}</textarea>
                <div style="margin-top: 1rem; display: flex; gap: 1rem;">
                    <button class="btn btn-primary" onclick="saveFirebaseConfig()">Conectar a la Nube</button>
                    <button class="btn" onclick="handleLogout()">Cerrar Sesión</button>
                </div>
            </div>

            <div class="form-section">
                <h3>📥 Copias de Seguridad</h3>
                <p style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 1rem;">Sugerimos hacer un respaldo semanal. Último éxito: <strong>${lastBackup}</strong></p>
                <button class="btn" onclick="exportBackupWithDate()"><i data-lucide="download" style="width: 16px; margin-right: 5px;"></i>Descargar JSON</button>
            </div>
        </div>
    `;
    lucide.createIcons();
};

window.copyMasterKey = () => {
    const input = document.getElementById('master-key-input');
    input.select();
    navigator.clipboard.writeText(input.value);
    alert("¡Llave maestra copiada! Guárdala en un lugar seguro.");
};

window.exportBackupWithDate = async () => {
    await exportBackup();
    localStorage.setItem('lastBackupDate', new Date().toLocaleString());
    renderSettings();
};

window.showEditEntryModal = async (record) => {
    const modal = document.getElementById('modal-container');
    modal.classList.remove('hidden');
    
    const dReason = await decryptData(record.reason);
    const dDiag = await decryptData(record.diagnosis);
    const dPlan = await decryptData(record.treatmentPlan);
    const dEvo = await decryptData(record.evolution);

    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center; z-index: 100;">
            <div class="card" style="width: 800px; max-height: 90vh; overflow-y: auto;">
                <h2>Editar Evolución Clínica</h2>
                <form id="edit-entry-form" style="margin-top: 1.5rem;">
                    <input type="hidden" name="patientId" value="${record.patientId}">
                    <div class="form-group">
                        <label>Fecha</label>
                        <input type="date" name="date" value="${record.date}" required>
                    </div>
                    <div class="form-group">
                        <label>Motivo de Consulta</label>
                        <textarea name="reason" required>${dReason}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Diagnóstico</label>
                        <textarea name="diagnosis" required>${dDiag}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Plan de Tratamiento</label>
                        <textarea name="treatmentPlan" required>${dPlan}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Evolución</label>
                        <textarea name="evolution" required>${dEvo}</textarea>
                    </div>
                    <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem;">
                        <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Guardar Cambios</button>
                    </div>
                </form>
            </div>
        </div>
    `;
};

window.showAddAppointmentModal = async () => {
    const patients = await db.patients.toArray();
    const modal = document.getElementById('modal-container');
    modal.classList.remove('hidden');
    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center; z-index: 100;">
            <div class="card" style="width: 500px;">
                <h2>Programar Cita</h2>
                <form id="add-appointment-form" style="margin-top: 1.5rem;">
                    <div class="form-group">
                        <label>Paciente</label>
                        <select name="patientId" required>
                            <option value="">Selecciona un paciente...</option>
                            ${patients.map(p => `<option value="${p.id}">${p.name} ${p.surname1}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-grid">
                        <div class="form-group">
                            <label>Fecha</label>
                            <input type="date" name="date" required>
                        </div>
                        <div class="form-group">
                            <label>Hora</label>
                            <input type="time" name="time" required>
                        </div>
                    </div>
                    <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem;">
                        <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Agendar</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.getElementById('add-appointment-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        data.status = 'pending';
        await db.appointments.add(data);
        closeModal();
        renderAppointments();
    };
};

window.sendAppointmentReminder = async (id) => {
    const app = await db.appointments.get(id);
    const patient = await db.patients.get(parseInt(app.patientId));
    const clinicName = localStorage.getItem('clinicName') || 'Program Clinic';
    
    if (!patient.mobile) {
        alert("El paciente no tiene celular registrado.");
        return;
    }
    
    const text = `Hola ${patient.name}, te confirmamos tu cita en ${clinicName}:
📅 Fecha: ${app.date}
⏰ Hora: ${app.time}
¡Te esperamos!`;
    
    window.open(`https://wa.me/${patient.mobile.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank');
};

window.addToGoogleCalendar = async (id) => {
    const app = await db.appointments.get(id);
    const patient = await db.patients.get(parseInt(app.patientId));
    const clinicName = localStorage.getItem('clinicName') || 'Program Clinic';
    
    const start = `${app.date.replace(/-/g, '')}T${app.time.replace(/:/g, '')}00`;
    const end = `${app.date.replace(/-/g, '')}T${(parseInt(app.time.split(':')[0]) + 1).toString().padStart(2, '0')}${app.time.split(':')[1]}00`;
    
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Cita: ' + patient.name)}&dates=${start}/${end}&details=${encodeURIComponent('Cita odontológica en ' + clinicName)}&location=${encodeURIComponent(clinicName)}`;
    
    window.open(url, '_blank');
};

window.deleteAppointment = async (id) => {
    if (confirm("¿Estás seguro de eliminar esta cita?")) {
        await db.appointments.delete(id);
        renderAppointments();
    }
};
window.saveFirebaseConfig = () => {
    const input = document.getElementById('fb-config-input').value;
    if (!input) return;
    try {
        JSON.parse(input);
        localStorage.setItem('firebaseConfig', input);
        alert("Configuración guardada. La página se recargará.");
        location.reload();
    } catch (e) {
        alert("Error: El formato JSON no es válido.");
    }
};

window.showAuthModal = (type) => {
    const modal = document.getElementById('modal-container');
    modal.classList.remove('hidden');
    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: grid; place-items: center; z-index: 100;">
            <div class="card" style="width: 400px; padding: 2rem;">
                <h2>${type === 'login' ? 'Iniciar Sesión' : 'Registrarse'}</h2>
                <form id="auth-form" style="margin-top: 1rem;">
                    <div class="form-group">
                        <label>Correo Electrónico</label>
                        <input type="email" name="email" required>
                    </div>
                    <div class="form-group">
                        <label>Contraseña</label>
                        <input type="password" name="password" required>
                    </div>
                    <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                        <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
                        <button type="submit" class="btn btn-primary">${type === 'login' ? 'Entrar' : 'Crear Cuenta'}</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.getElementById('auth-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const email = fd.get('email');
        const pass = fd.get('password');
        
        try {
            if (type === 'login') {
                await auth.signInWithEmailAndPassword(email, pass);
            } else {
                await auth.createUserWithEmailAndPassword(email, pass);
            }
            closeModal();
            renderSettings();
        } catch (error) {
            alert("Error: " + error.message);
        }
    };
};

window.handleLogout = async () => {
    await auth.signOut();
    renderSettings();
};

window.handleLogoUpload = (input) => {
    const file = input.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            localStorage.setItem('clinicLogo', e.target.result);
            applyClinicBranding();
        };
        reader.readAsDataURL(file);
    }
};

window.showImageModal = (src) => {
    const modal = document.getElementById('modal-container');
    modal.classList.remove('hidden');
    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); display: flex; align-items: center; justify-content: center; z-index: 200; cursor: zoom-out;" onclick="closeModal()">
            <img src="${src}" style="max-width: 95%; max-height: 95%; border-radius: 8px; box-shadow: 0 0 50px rgba(0,0,0,1);">
            <button class="btn" style="position: absolute; top: 20px; right: 20px; background: rgba(255,255,255,0.1); color: white;" onclick="closeModal()">Cerrar (X)</button>
        </div>
    `;
};

window.handleAttachment = (input, suffix = '') => {
    const files = Array.from(input.files);
    const preview = document.getElementById('attachment-preview' + suffix);
    const hidden = document.getElementById('attachments-data' + suffix);
    let attachments = JSON.parse(hidden.value || '[]');

    let loadedCount = 0;
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            attachments.push(e.target.result);
            loadedCount++;
            if (loadedCount === files.length) {
                hidden.value = JSON.stringify(attachments);
                renderAttachmentPreview(attachments, preview, suffix);
            }
        };
        reader.readAsDataURL(file);
    });
};

window.removeAttachment = (index, suffix = '') => {
    const hidden = document.getElementById('attachments-data' + suffix);
    const preview = document.getElementById('attachment-preview' + suffix);
    let attachments = JSON.parse(hidden.value || '[]');
    attachments.splice(index, 1);
    hidden.value = JSON.stringify(attachments);
    renderAttachmentPreview(attachments, preview, suffix);
};

function renderAttachmentPreview(attachments, container, suffix) {
    container.innerHTML = '';
    attachments.forEach((src, i) => {
        const div = document.createElement('div');
        div.style.cssText = 'position: relative; display: inline-block; margin-right: 10px; margin-top: 10px;';
        div.innerHTML = `
            <img src="${src}" style="height: 80px; border-radius: 4px; border: 1px solid var(--border); cursor: pointer;" onclick="showImageModal(this.src)">
            <button type="button" onclick="removeAttachment(${i}, '${suffix}')" style="position: absolute; top: -5px; right: -5px; background: var(--danger); color: white; border: none; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3); z-index: 10;">×</button>
        `;
        container.appendChild(div);
    });
}

window.saveClinicInfo = () => {
    const name = document.getElementById('set-clinic-name').value;
    const nit = document.getElementById('set-clinic-nit').value;
    localStorage.setItem('clinicName', name);
    localStorage.setItem('clinicNIT', nit);
    applyClinicBranding();
    alert("Información de la clínica guardada.");
};

window.toggleTheme = () => {
    const current = localStorage.getItem('theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme();
    renderSettings();
};

window.setPrimaryColor = (color) => {
    localStorage.setItem('primaryColor', color);
    applyTheme();
    renderSettings();
};

window.exportBackup = async () => {
    const patients = await db.patients.toArray();
    const records = await db.records.toArray();
    const settings = {
        clinicName: localStorage.getItem('clinicName'),
        clinicNIT: localStorage.getItem('clinicNIT'),
        theme: localStorage.getItem('theme'),
        primaryColor: localStorage.getItem('primaryColor'),
        habeasDataEnabled: localStorage.getItem('habeasDataEnabled')
    };
    
    const data = {
        patients,
        records,
        settings,
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_clinic_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
};

window.sendWhatsApp = async (patientId, recordId) => {
    const patient = await db.patients.get(patientId);
    const record = await db.records.get(recordId);
    const clinicName = localStorage.getItem('clinicName') || 'Program Clinic';
    
    if (!patient.mobile) {
        alert("El paciente no tiene un número de celular registrado.");
        return;
    }
    
    const text = `Hola ${patient.name}, te saludo de ${clinicName}. 
Queremos compartirte un resumen de tu consulta del día ${record.date}:
- Motivo: ${record.motive}
- Diagnóstico: ${record.diagnosis}
- Plan: ${record.plan_desc_0 || 'Ver odontograma'}

Para más detalles, consulta con tu odontólogo.`;
    
    const url = `https://wa.me/${patient.mobile.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
};

// Modal Helpers
window.closeModal = () => {
    document.getElementById('modal-container').classList.add('hidden');
};

// Global functions for dental application
window.showAddPatientModal = () => {
    const modal = document.getElementById('modal-container');
    modal.classList.remove('hidden');
    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; align-items: flex-start; justify-content: center; z-index: 100; overflow-y: auto; padding: 2rem;">
            <div class="card" style="width: 900px; max-width: 100%;">
                <h2>IDENTIFICACIÓN DEL PACIENTE</h2>
                <form id="add-patient-form" style="margin-top: 1.5rem;">
                    <div class="form-grid">
                        <div class="form-group"><label>Primer Apellido</label><input type="text" name="surname1" required></div>
                        <div class="form-group"><label>Segundo Apellido</label><input type="text" name="surname2"></div>
                        <div class="form-group"><label>Nombre(s)</label><input type="text" name="name" required></div>
                        <div class="form-group"><label>Documento</label><input type="text" name="document" required></div>
                    </div>
                    <div class="form-grid">
                        <div class="form-group"><label>Fecha de Nacimiento</label><input type="date" name="birthday"></div>
                        <div class="form-group"><label>Edad</label><input type="number" name="age"></div>
                        <div class="form-group"><label>Sexo</label><select name="gender"><option>M</option><option>F</option></select></div>
                        <div class="form-group"><label>Estado Civil</label><input type="text" name="civilStatus"></div>
                    </div>
                    <div class="form-grid">
                        <div class="form-group"><label>Ocupación</label><input type="text" name="occupation"></div>
                        <div class="form-group"><label>Aseguradora</label><input type="text" name="insurance"></div>
                        <div class="form-group"><label>Lugar de Residencia</label><input type="text" name="residence"></div>
                        <div class="form-group"><label>Teléfono/Celular</label><input type="text" name="mobile"></div>
                    </div>
                    <hr style="margin: 1rem 0; border: 0; border-top: 1px solid var(--border);">
                    <div class="form-grid">
                        <div class="form-group"><label>Nombre Responsable</label><input type="text" name="contactName"></div>
                        <div class="form-group"><label>Parentesco</label><input type="text" name="contactRelationship"></div>
                        <div class="form-group"><label>Teléfono Responsable</label><input type="text" name="contactPhone"></div>
                    </div>
                    ${localStorage.getItem('habeasDataEnabled') === 'true' ? `
                        <div class="check-item" style="margin-top: 1rem; background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 8px;">
                            <input type="checkbox" name="habeasConsent" required>
                            <label style="font-size: 0.75rem;">Acepto el tratamiento de mis datos personales de acuerdo con la Ley 1581 de 2012 (Habeas Data) y la política de privacidad de la clínica.</label>
                        </div>
                    ` : ''}
                    <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem;">
                        <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Guardar Paciente</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.getElementById('add-patient-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        await db.patients.add(data);
        closeModal();
        if (currentState.currentView === 'patients') renderPatients();
        else renderDashboard();
    };
};

window.showEditPatientModal = async (id) => {
    const p = await db.patients.get(id);
    const modal = document.getElementById('modal-container');
    modal.classList.remove('hidden');
    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; align-items: flex-start; justify-content: center; z-index: 100; overflow-y: auto; padding: 2rem;">
            <div class="card" style="width: 900px; max-width: 100%;">
                <h2>EDITAR DATOS DEL PACIENTE</h2>
                <form id="edit-patient-form" style="margin-top: 1.5rem;">
                    <div class="form-grid">
                        <div class="form-group"><label>Primer Apellido</label><input type="text" name="surname1" value="${p.surname1 || ''}" required></div>
                        <div class="form-group"><label>Segundo Apellido</label><input type="text" name="surname2" value="${p.surname2 || ''}"></div>
                        <div class="form-group"><label>Nombre(s)</label><input type="text" name="name" value="${p.name || ''}" required></div>
                        <div class="form-group"><label>Documento</label><input type="text" name="document" value="${p.document || ''}" required></div>
                    </div>
                    <div class="form-grid">
                        <div class="form-group"><label>Fecha de Nacimiento</label><input type="date" name="birthday" value="${p.birthday || ''}"></div>
                        <div class="form-group"><label>Edad</label><input type="number" name="age" value="${p.age || ''}"></div>
                        <div class="form-group"><label>Sexo</label><select name="gender"><option ${p.gender === 'M' ? 'selected' : ''}>M</option><option ${p.gender === 'F' ? 'selected' : ''}>F</option></select></div>
                        <div class="form-group"><label>Estado Civil</label><input type="text" name="civilStatus" value="${p.civilStatus || ''}"></div>
                    </div>
                    <div class="form-grid">
                        <div class="form-group"><label>Ocupación</label><input type="text" name="occupation" value="${p.occupation || ''}"></div>
                        <div class="form-group"><label>Aseguradora</label><input type="text" name="insurance" value="${p.insurance || ''}"></div>
                        <div class="form-group"><label>Lugar de Residencia</label><input type="text" name="residence" value="${p.residence || ''}"></div>
                        <div class="form-group"><label>Teléfono/Celular</label><input type="text" name="mobile" value="${p.mobile || ''}"></div>
                    </div>
                    <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem;">
                        <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Actualizar Datos</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.getElementById('edit-patient-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        await db.patients.update(id, data);
        closeModal();
        renderPatients();
    };
};

window.viewPatientHistory = async (id) => {
    currentState.selectedPatientId = id;
    const patient = await db.patients.get(id);
    const records = await db.records.where('patientId').equals(id).toArray();
    
    viewTitle.textContent = `HC: ${patient.surname1} ${patient.name}`;
    
    mainView.innerHTML = `
        <div style="margin-bottom: 2rem; display: flex; gap: 1rem;">
            <button class="btn" onclick="switchView('patients')">← Volver</button>
            <button class="btn" style="background: #6366f1; color: white;" onclick="printConsent(${id})">📄 Consentimiento Legal</button>
            <button class="btn btn-primary" onclick="showNewEntryForm(${id})">+ Nueva Consulta</button>
        </div>

        <div class="tabs">
            <div class="tab active" onclick="showRecordTab('history')">Historial de Consultas</div>
            <div class="tab" onclick="showRecordTab('info')">Información General</div>
        </div>

        <div id="patient-record-content">
            ${await renderConsultationHistory(records)}
        </div>
    `;
};

async function renderConsultationHistory(records) {
    if (records.length === 0) return '<p style="text-align: center; color: var(--text-muted); padding: 3rem;">No hay consultas registradas para este paciente.</p>';
    
    return (await Promise.all(records.reverse().map(async r => {
        const dMotive = await decryptData(r.motive);
        const dDiag = await decryptData(r.diagnosis);
        const dMeds = await decryptData(r.medicaments);
        const dObs = await decryptData(r.observations);
        const attachments = r.attachments ? JSON.parse(r.attachments) : [];
        
        return `
            <div class="card" style="margin-bottom: 1.5rem; border-left: 5px solid var(--primary);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 1rem;">
                    <span style="font-weight: 600; color: var(--primary);">${r.date}</span>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn" style="padding: 0.25rem 0.75rem; font-size: 0.75rem; background: var(--primary); color: white;" onclick="printPrescription(${r.id})">Receta</button>
                        <button class="btn" style="padding: 0.25rem 0.75rem; font-size: 0.75rem; background: #25D366; color: white;" onclick="sendWhatsApp(${r.patientId}, ${r.id})">WhatsApp</button>
                        <button class="btn" style="padding: 0.25rem 0.75rem; font-size: 0.75rem; background: var(--border);" onclick="showEditEntryForm(${r.patientId}, ${r.id})">Editar</button>
                        <span style="font-size: 0.875rem; color: var(--text-muted);">ID: #${r.id}</span>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
                    <div>
                        <strong>Motivo de Consulta:</strong>
                        <p style="margin-top: 0.5rem; color: var(--text-muted);">${dMotive}</p>
                    </div>
                    <div>
                        <strong>Diagnóstico:</strong>
                        <p style="margin-top: 0.5rem; color: var(--text-muted);">${dDiag}</p>
                    </div>
                </div>
                ${attachments.length > 0 ? `
                    <div style="margin-top: 1.5rem; border-top: 1px solid var(--border); padding-top: 1rem;">
                        <strong>Adjuntos (Radiografías/Exámenes):</strong>
                        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; overflow-x: auto; padding-bottom: 0.5rem;">
                            ${attachments.map(img => `<img src="${img}" style="height: 100px; border-radius: 4px; cursor: pointer; border: 1px solid var(--border);" onclick="showImageModal(this.src)">`).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }))).join('');
}

window.deletePatient = async (id) => {
    if (confirm("¿ESTÁS SEGURO? Esta acción eliminará al paciente permanentemente junto con TODAS sus historias clínicas, citas y cotizaciones asociadas. Esta acción no se puede deshacer.")) {
        await db.records.where('patientId').equals(id).delete();
        await db.appointments.where('patientId').equals(id).delete();
        await db.quotations.where('patientId').equals(id).delete();
        await db.patients.delete(id);
        renderPatients();
    }
};

window.showNewEntryForm = async (patientId) => {
    mainView.innerHTML = `
        <div style="margin-bottom: 2rem;">
            <button class="btn" onclick="viewPatientHistory(${patientId})">← Cancelar y Volver</button>
        </div>
        
        <form id="complex-history-form">
            <div class="form-section">
                <h3>1. MOTIVO DE CONSULTA Y EVOLUCIÓN</h3>
                <div class="form-group">
                    <label>Motivo de Consulta</label>
                    <textarea name="motive" required rows="2"></textarea>
                </div>
                <div class="form-group">
                    <label>Evolución y Estado Actual (Síntomas)</label>
                    <textarea name="symptoms" rows="3"></textarea>
                </div>
                <div class="form-group">
                    <label>Antecedentes Familiares</label>
                    <textarea name="familyHistory" rows="2"></textarea>
                </div>
            </div>

            <div class="form-section">
                <h3>2. ANTECEDENTES MÉDICOS Y ODONTOLÓGICOS</h3>
                <div class="backgrounds-grid">
                    ${['Alergias', 'Hepatitis', 'Trastornos gástricos', 'Diabetes', 'Cardiopatías', 'Fiebre reumática', 'Sinusitis', 'Embarazo', 'HIV-SIDA', 'Cirugías', 'Presión arterial', 'Inmunopresión', 'Exodoncias', 'Patologías renales', 'Patologías respiratorias', 'Uso de prótesis'].map(item => `
                        <div class="check-item">
                            <input type="checkbox" name="bg_${item.replace(/ /g, '_')}">
                            <label>${item}</label>
                        </div>
                    `).join('')}
                </div>
                <div class="form-group" style="margin-top: 1.5rem;">
                    <label>Observaciones y Hábitos</label>
                    <textarea name="observations" rows="2"></textarea>
                </div>
            </div>

            <div class="form-section">
                <h3>3. EXAMEN ESTOMATOLÓGICO Y CLÍNICO</h3>
                <div class="form-grid">
                    <div class="form-group"><label>Labios</label><input type="text" name="exam_lips"></div>
                    <div class="form-group"><label>Lengua</label><input type="text" name="exam_tongue"></div>
                    <div class="form-group"><label>Paladar</label><input type="text" name="exam_palate"></div>
                    <div class="form-group"><label>Oro faringe</label><input type="text" name="exam_pharynx"></div>
                </div>
                <div class="form-grid">
                    <div class="form-group"><label>ATM (Ruidos/Desviación)</label><input type="text" name="exam_atm"></div>
                    <div class="form-group"><label>Mucosa Oral</label><input type="text" name="exam_mucosa"></div>
                </div>
            </div>

            <div class="form-section">
                <h3>4. ODONTOGRAMA Y DIAGNÓSTICO</h3>
                <div class="odontogram-container" id="odontogram-render">
                    <!-- Odontogram will be injected here -->
                    <p style="color: #64748b;">(Cargando odontograma...)</p>
                </div>
                <div class="form-group" style="margin-top: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <label>Hallazgos y Diagnósticos Dentales</label>
                        <button type="button" class="btn btn-sm" style="background: var(--primary); color: white;" onclick="showPrescriptionSelector('complex-history-form')">🔍 Cargar Plantilla / Receta</button>
                    </div>
                    <textarea name="diagnosis" id="diag-input" rows="3" placeholder="Articular, Pulpar, Periodontal, Dental, Oclusal..."></textarea>
                </div>
                <div class="form-group" style="margin-top: 1rem;">
                    <label>Prescripción Médica (Medicamentos y Posología)</label>
                    <textarea name="medicaments" id="meds-input" rows="4" placeholder="Ej: Ibuprofeno 600mg cada 6 horas..."></textarea>
                </div>
            </div>

            <div class="form-section">
                <h3>5. PLAN DE TRATAMIENTO</h3>
                <table class="treatment-table">
                    <thead>
                        <tr>
                            <th>Cant</th>
                            <th>Procedimiento</th>
                            <th>VR Unidad</th>
                            <th>VR Total</th>
                        </tr>
                    </thead>
                    <tbody id="treatment-items">
                        <tr>
                            <td><input type="number" name="plan_qty_0" style="width: 60px;"></td>
                            <td><input type="text" name="plan_desc_0"></td>
                            <td><input type="number" name="plan_price_0"></td>
                            <td><input type="number" name="plan_total_0" readonly></td>
                        </tr>
                    </tbody>
                </table>
                <button type="button" class="btn" style="margin-top: 1rem;" onclick="addTreatmentRow()">+ Añadir Fila</button>
            </div>

            <div class="form-section">
                <h3>6. ARCHIVOS Y ADJUNTOS (Radiografías, Exámenes)</h3>
                <div class="form-group">
                    <label>Subir Documentos / Imágenes</label>
                    <input type="file" id="consultation-files" accept="image/*" multiple onchange="handleAttachment(this)">
                    <div id="attachment-preview" style="display: flex; gap: 1rem; margin-top: 1rem; flex-wrap: wrap;"></div>
                    <input type="hidden" name="attachments" id="attachments-data">
                </div>
            </div>

            <div style="margin-top: 3rem; display: flex; gap: 1rem; justify-content: center;">
                <button type="submit" class="btn btn-primary" style="padding: 1rem 4rem; font-size: 1.125rem;">GUARDAR HISTORIA CLÍNICA COMPLETA</button>
            </div>
        </form>
    `;

    // Render Odontogram
    renderOdontogram(document.getElementById('odontogram-render'));

    document.getElementById('complex-history-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        
        // Encrypt sensitive fields
        data.motive = await encryptData(data.motive);
        data.symptoms = await encryptData(data.symptoms);
        data.familyHistory = await encryptData(data.familyHistory);
        data.observations = await encryptData(data.observations);
        data.diagnosis = await encryptData(data.diagnosis);
        data.medicaments = await encryptData(data.medicaments);

        // Collect odontogram state
        const activeParts = [];
        document.querySelectorAll('.tooth-part.active').forEach(part => {
            const tooth = part.parentElement.dataset.tooth;
            const area = part.style.gridArea;
            activeParts.push({ tooth, area });
        });
        data.odontogram = JSON.stringify(activeParts);
        
        data.patientId = patientId;
        data.date = new Date().toLocaleString();
        
        await db.records.add(data);
        viewPatientHistory(patientId);
    };
};

window.showEditEntryForm = async (patientId, recordId) => {
    const r = await db.records.get(recordId);
    
    const [dMotive, dSymptoms, dFamily, dObs, dDiag] = await Promise.all([
        decryptData(r.motive), decryptData(r.symptoms), decryptData(r.familyHistory),
        decryptData(r.observations), decryptData(r.diagnosis)
    ]);
    
    mainView.innerHTML = `
        <div style="margin-bottom: 2rem;">
            <button class="btn" onclick="viewPatientHistory(${patientId})">← Cancelar y Volver</button>
        </div>
        
        <form id="edit-history-form">
            <div class="form-section">
                <h3>1. MOTIVO DE CONSULTA Y EVOLUCIÓN (Edición)</h3>
                <div class="form-group">
                    <label>Motivo de Consulta</label>
                    <textarea name="motive" required rows="2">${dMotive || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Evolución y Estado Actual (Síntomas)</label>
                    <textarea name="symptoms" rows="3">${dSymptoms || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Antecedentes Familiares</label>
                    <textarea name="familyHistory" rows="2">${dFamily || ''}</textarea>
                </div>
            </div>

            <div class="form-section">
                <h3>2. ANTECEDENTES MÉDICOS Y ODONTOLÓGICOS</h3>
                <div class="backgrounds-grid">
                    ${['Alergias', 'Hepatitis', 'Trastornos gástricos', 'Diabetes', 'Cardiopatías', 'Fiebre reumática', 'Sinusitis', 'Embarazo', 'HIV-SIDA', 'Cirugías', 'Presión arterial', 'Inmunopresión', 'Exodoncias', 'Patologías renales', 'Patologías respiratorias', 'Uso de prótesis'].map(item => {
                        const checked = r[`bg_${item.replace(/ /g, '_')}`] === 'on' ? 'checked' : '';
                        return `
                            <div class="check-item">
                                <input type="checkbox" name="bg_${item.replace(/ /g, '_')}" ${checked}>
                                <label>${item}</label>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="form-group" style="margin-top: 1.5rem;">
                    <label>Observaciones y Hábitos</label>
                    <textarea name="observations" rows="2">${dObs || ''}</textarea>
                </div>
            </div>

            <div class="form-section">
                <h3>3. EXAMEN ESTOMATOLÓGICO Y CLÍNICO</h3>
                <div class="form-grid">
                    <div class="form-group"><label>Labios</label><input type="text" name="exam_lips" value="${r.exam_lips || ''}"></div>
                    <div class="form-group"><label>Lengua</label><input type="text" name="exam_tongue" value="${r.exam_tongue || ''}"></div>
                    <div class="form-group"><label>Paladar</label><input type="text" name="exam_palate" value="${r.exam_palate || ''}"></div>
                    <div class="form-group"><label>Oro faringe</label><input type="text" name="exam_pharynx" value="${r.exam_pharynx || ''}"></div>
                </div>
            </div>

            <div class="form-section">
                <h3>4. ODONTOGRAMA Y DIAGNÓSTICO</h3>
                <div class="odontogram-container" id="odontogram-edit"></div>
                <div class="form-group" style="margin-top: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <label>Hallazgos y Diagnósticos Dentales</label>
                        <button type="button" class="btn btn-sm" style="background: var(--primary); color: white;" onclick="showPrescriptionSelector('edit-history-form')">🔍 Cargar Plantilla / Receta</button>
                    </div>
                    <textarea name="diagnosis" id="diag-input-edit" rows="3">${dDiag || ''}</textarea>
                </div>
                <div class="form-group" style="margin-top: 1rem;">
                    <label>Prescripción Médica (Medicamentos y Posología)</label>
                    <textarea name="medicaments" id="meds-input-edit" rows="4">${await decryptData(r.medicaments) || ''}</textarea>
                </div>
            </div>

            <div class="form-section">
                <h3>5. PLAN DE TRATAMIENTO</h3>
                <table class="treatment-table">
                    <thead>
                        <tr><th>Cant</th><th>Procedimiento</th><th>VR Unidad</th><th>VR Total</th></tr>
                    </thead>
                    <tbody id="treatment-items-edit">
                        ${[0,1,2,3,4].map(i => {
                            const qty = r[`plan_qty_${i}`] || '';
                            const desc = r[`plan_desc_${i}`] || '';
                            const price = r[`plan_price_${i}`] || '';
                            const total = r[`plan_total_${i}`] || '';
                            if (i > 0 && !desc) return '';
                            return `
                                <tr>
                                    <td><input type="number" name="plan_qty_${i}" value="${qty}" style="width: 60px;" oninput="updateRowTotalEdit(${i})"></td>
                                    <td><input type="text" name="plan_desc_${i}" value="${desc}"></td>
                                    <td><input type="number" name="plan_price_${i}" value="${price}" oninput="updateRowTotalEdit(${i})"></td>
                                    <td><input type="number" name="plan_total_${i}" value="${total}" readonly></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="form-section">
                <h3>6. ARCHIVOS Y ADJUNTOS</h3>
                <div class="form-group">
                    <label>Agregar más archivos</label>
                    <input type="file" accept="image/*" multiple onchange="handleAttachment(this, '-edit')">
                </div>
                <div id="attachment-preview-edit" style="display: flex; gap: 1rem; margin-top: 1rem; flex-wrap: wrap;">
                    ${r.attachments ? JSON.parse(r.attachments).map((img, i) => `
                        <div style="position: relative; display: inline-block;">
                            <img src="${img}" style="height: 80px; border-radius: 4px; border: 1px solid var(--border); cursor: pointer;" onclick="showImageModal(this.src)">
                            <button type="button" onclick="removeAttachment(${i}, '-edit')" style="position: absolute; top: -5px; right: -5px; background: var(--danger); color: white; border: none; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3); z-index: 10;">×</button>
                        </div>
                    `).join('') : ''}
                </div>
                <input type="hidden" name="attachments" id="attachments-data-edit" value='${r.attachments || '[]'}'>
            </div>

            <div style="margin-top: 3rem; display: flex; gap: 1rem; justify-content: center;">
                <button type="submit" class="btn btn-primary" style="padding: 1rem 4rem; font-size: 1.125rem;">ACTUALIZAR HISTORIA CLÍNICA</button>
            </div>
        </form>
    `;

    renderOdontogram(document.getElementById('odontogram-edit'));
    
    // Restore odontogram state
    if (r.odontogram) {
        const activeParts = JSON.parse(r.odontogram);
        activeParts.forEach(p => {
            const toothEl = document.querySelector(`#odontogram-edit [data-tooth="${p.tooth}"]`);
            if (toothEl) {
                const part = toothEl.querySelector(`.tooth-part[style*="grid-area: ${p.area}"]`);
                if (part) part.classList.add('active');
            }
        });
    }

    window.updateRowTotalEdit = (id) => {
        const qty = document.querySelector(`#edit-history-form [name="plan_qty_${id}"]`).value || 0;
        const price = document.querySelector(`#edit-history-form [name="plan_price_${id}"]`).value || 0;
        const totalInput = document.querySelector(`#edit-history-form [name="plan_total_${id}"]`);
        if (totalInput) totalInput.value = qty * price;
    };

    document.getElementById('edit-history-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        
        // Encrypt sensitive fields
        data.motive = await encryptData(data.motive);
        data.symptoms = await encryptData(data.symptoms);
        data.familyHistory = await encryptData(data.familyHistory);
        data.observations = await encryptData(data.observations);
        data.diagnosis = await encryptData(data.diagnosis);
        data.medicaments = await encryptData(data.medicaments);

        // Collect odontogram state
        const activeParts = [];
        document.querySelectorAll('#odontogram-edit .tooth-part.active').forEach(part => {
            const tooth = part.parentElement.dataset.tooth;
            const area = part.style.gridArea;
            activeParts.push({ tooth, area });
        });
        data.odontogram = JSON.stringify(activeParts);
        
        data.patientId = patientId;
        data.date = r.date;
        
        await db.records.update(recordId, data);
        viewPatientHistory(patientId);
    };
};

window.showRecordTab = (tab) => {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    const content = document.getElementById('patient-record-content');
    if (tab === 'history') {
        db.records.where('patientId').equals(currentState.selectedPatientId).toArray().then(records => {
            content.innerHTML = renderConsultationHistory(records);
        });
    } else {
        db.patients.get(currentState.selectedPatientId).then(p => {
            content.innerHTML = `
                <div class="card">
                    <h3>DATOS DE IDENTIFICACIÓN</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
                        <p><strong>Nombres:</strong> ${p.name} ${p.surname1} ${p.surname2}</p>
                        <p><strong>Documento:</strong> ${p.document}</p>
                        <p><strong>Teléfono:</strong> ${p.mobile}</p>
                        <p><strong>Edad:</strong> ${p.age}</p>
                        <p><strong>Residencia:</strong> ${p.residence}</p>
                        <p><strong>Seguro:</strong> ${p.insurance}</p>
                    </div>
                </div>
            `;
        });
    }
};

function renderOdontogram(container) {
    const rows = [
        { teeth: [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28], type: 'adult' },
        { teeth: [55,54,53,52,51, 61,62,63,64,65], type: 'kids' },
        { teeth: [85,84,83,82,81, 71,72,73,74,75], type: 'kids' },
        { teeth: [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38], type: 'adult' }
    ];
    
    container.innerHTML = rows.map((row, i) => `
        <div class="teeth-row" style="${i === 1 || i === 2 ? 'margin: 1rem 0; gap: 1rem;' : ''}">
            ${row.teeth.map(n => `
                <div class="tooth">
                    ${i < 2 ? `<span class="tooth-num">${n}</span>` : ''}
                    <div class="tooth-box" data-tooth="${n}">
                        <div class="tooth-part" style="grid-area: top" onclick="toggleToothPart(this)"></div>
                        <div class="tooth-part" style="grid-area: left" onclick="toggleToothPart(this)"></div>
                        <div class="tooth-part" style="grid-area: center" onclick="toggleToothPart(this)"></div>
                        <div class="tooth-part" style="grid-area: right" onclick="toggleToothPart(this)"></div>
                        <div class="tooth-part" style="grid-area: bottom" onclick="toggleToothPart(this)"></div>
                    </div>
                    ${i >= 2 ? `<span class="tooth-num">${n}</span>` : ''}
                </div>
            `).join('')}
        </div>
    `).join('<hr style="width: 100%; border: 0; border-top: 1px dotted #cbd5e1; margin: 1rem 0;">');
}

window.toggleToothPart = (el) => {
    el.classList.toggle('active');
};

let treatmentRowCount = 1;
window.addTreatmentRow = () => {
    const tbody = document.getElementById('treatment-items');
    const tr = document.createElement('tr');
    const id = treatmentRowCount;
    tr.innerHTML = `
        <td><input type="number" name="plan_qty_${id}" style="width: 60px;" oninput="updateRowTotal(${id})"></td>
        <td><input type="text" name="plan_desc_${id}"></td>
        <td><input type="number" name="plan_price_${id}" oninput="updateRowTotal(${id})"></td>
        <td><input type="number" name="plan_total_${id}" readonly></td>
    `;
    tbody.appendChild(tr);
    treatmentRowCount++;
};

window.updateRowTotal = (id) => {
    const qty = document.querySelector(`[name="plan_qty_${id}"]`).value || 0;
    const price = document.querySelector(`[name="plan_price_${id}"]`).value || 0;
    document.querySelector(`[name="plan_total_${id}"]`).value = qty * price;
};

// Export to make it available for switchView in setupNav
window.renderDashboard = renderDashboard;
window.renderPatients = renderPatients;
window.switchView = switchView;

window.showNewQuotationModal = async () => {
    const patients = await db.patients.toArray();
    const modal = document.getElementById('modal-container');
    modal.classList.remove('hidden');
    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; align-items: flex-start; justify-content: center; z-index: 100; overflow-y: auto; padding: 2rem;">
            <div class="card" style="width: 800px;">
                <h2>Nueva Cotización</h2>
                <form id="new-quotation-form" style="margin-top: 1.5rem;">
                    <div class="form-group">
                        <label>Seleccionar Paciente (opcional)</label>
                        <select id="quo-patient-select" onchange="updateQuoName(this)">
                            <option value="">-- Paciente No Registrado / Manual --</option>
                            ${patients.map(p => `<option value="${p.id}" data-name="${p.name} ${p.surname1}">${p.name} ${p.surname1}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Nombre del Cliente/Paciente</label>
                        <input type="text" name="patientName" id="quo-patient-name" required placeholder="Nombre completo">
                        <input type="hidden" name="patientId" id="quo-patient-id">
                    </div>
                    
                    <table class="treatment-table">
                        <thead><tr><th>Cant</th><th>Descripción</th><th>Precio</th><th>Total</th></tr></thead>
                        <tbody id="quotation-items">
                            <tr>
                                <td><input type="number" name="qty_0" style="width: 60px;" oninput="updateQuoTotal(0)" value="1"></td>
                                <td><input type="text" name="desc_0" required></td>
                                <td><input type="number" name="price_0" oninput="updateQuoTotal(0)"></td>
                                <td><input type="number" name="total_0" readonly></td>
                            </tr>
                        </tbody>
                    </table>
                    <button type="button" class="btn" style="margin-top: 1rem;" onclick="addQuoRow()">+ Añadir Fila</button>

                    <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem;">
                        <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Generar Cotización</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.getElementById('new-quotation-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        data.date = new Date().toLocaleDateString();
        
        let total = 0;
        const items = [];
        for(let i=0; i<10; i++) {
            if(data[`desc_${i}`]) {
                const itemTotal = (data[`qty_${i}`] || 0) * (data[`price_${i}`] || 0);
                items.push({ desc: data[`desc_${i}`], qty: data[`qty_${i}`], price: data[`price_${i}`], total: itemTotal });
                total += itemTotal;
            }
        }
        data.items = JSON.stringify(items);
        data.total = total;
        
        await db.quotations.add(data);
        closeModal();
        renderQuotations();
    };
};

window.showEditQuotationModal = async (quotationId) => {
    const q = await db.quotations.get(quotationId);
    const patients = await db.patients.toArray();
    const items = JSON.parse(q.items || '[]');
    const modal = document.getElementById('modal-container');
    modal.classList.remove('hidden');
    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; align-items: flex-start; justify-content: center; z-index: 100; overflow-y: auto; padding: 2rem;">
            <div class="card" style="width: 800px;">
                <h2>Editar Cotización</h2>
                <form id="edit-quotation-form" style="margin-top: 1.5rem;">
                    <div class="form-group">
                        <label>Nombre del Cliente/Paciente</label>
                        <input type="text" name="patientName" value="${q.patientName}" required placeholder="Nombre completo">
                        <input type="hidden" name="patientId" value="${q.patientId || ''}">
                    </div>
                    
                    <table class="treatment-table">
                        <thead><tr><th>Cant</th><th>Descripción</th><th>Precio</th><th>Total</th></tr></thead>
                        <tbody id="quotation-items-edit">
                            ${items.map((item, i) => `
                                <tr>
                                    <td><input type="number" name="qty_${i}" style="width: 60px;" oninput="updateQuoTotalEdit(${i})" value="${item.qty}"></td>
                                    <td><input type="text" name="desc_${i}" required value="${item.desc}"></td>
                                    <td><input type="number" name="price_${i}" oninput="updateQuoTotalEdit(${i})" value="${item.price}"></td>
                                    <td><input type="number" name="total_${i}" readonly value="${item.total}"></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <button type="button" class="btn" style="margin-top: 1rem;" onclick="addQuoRowEdit()">+ Añadir Fila</button>

                    <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem;">
                        <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Guardar Cambios</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    let quoEditRowCount = items.length;
    window.addQuoRowEdit = () => {
        const tbody = document.getElementById('quotation-items-edit');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="number" name="qty_${quoEditRowCount}" style="width: 60px;" oninput="updateQuoTotalEdit(${quoEditRowCount})" value="1"></td>
            <td><input type="text" name="desc_${quoEditRowCount}"></td>
            <td><input type="number" name="price_${quoEditRowCount}" oninput="updateQuoTotalEdit(${quoEditRowCount})"></td>
            <td><input type="number" name="total_${quoEditRowCount}" readonly></td>
        `;
        tbody.appendChild(tr);
        quoEditRowCount++;
    };

    window.updateQuoTotalEdit = (id) => {
        const qtyInput = document.querySelector(`#edit-quotation-form [name="qty_${id}"]`);
        const priceInput = document.querySelector(`#edit-quotation-form [name="price_${id}"]`);
        const totalInput = document.querySelector(`#edit-quotation-form [name="total_${id}"]`);
        if(qtyInput && priceInput && totalInput) {
            totalInput.value = (qtyInput.value || 0) * (priceInput.value || 0);
        }
    };

    document.getElementById('edit-quotation-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        
        let total = 0;
        const newItems = [];
        for(let i=0; i<20; i++) {
            if(data[`desc_${i}`]) {
                const itemTotal = (data[`qty_${i}`] || 0) * (data[`price_${i}`] || 0);
                newItems.push({ desc: data[`desc_${i}`], qty: data[`qty_${i}`], price: data[`price_${i}`], total: itemTotal });
                total += itemTotal;
            }
        }
        const updateData = {
            patientName: data.patientName,
            patientId: data.patientId,
            items: JSON.stringify(newItems),
            total: total,
            date: q.date // Keep original date
        };
        
        await db.quotations.update(quotationId, updateData);
        closeModal();
        renderQuotations();
    };
};

window.updateQuoName = (sel) => {
    const opt = sel.options[sel.selectedIndex];
    document.getElementById('quo-patient-name').value = opt.dataset.name || '';
    document.getElementById('quo-patient-id').value = sel.value || '';
};

let quoRowCount = 1;
window.addQuoRow = () => {
    const tbody = document.getElementById('quotation-items');
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="number" name="qty_${quoRowCount}" style="width: 60px;" oninput="updateQuoTotal(${quoRowCount})" value="1"></td>
        <td><input type="text" name="desc_${quoRowCount}"></td>
        <td><input type="number" name="price_${quoRowCount}" oninput="updateQuoTotal(${quoRowCount})"></td>
        <td><input type="number" name="total_${quoRowCount}" readonly></td>
    `;
    tbody.appendChild(tr);
    quoRowCount++;
};

window.updateQuoTotal = (id) => {
    const qtyInput = document.querySelector(`[name="qty_${id}"]`);
    const priceInput = document.querySelector(`[name="price_${id}"]`);
    const totalInput = document.querySelector(`[name="total_${id}"]`);
    if(qtyInput && priceInput && totalInput) {
        totalInput.value = (qtyInput.value || 0) * (priceInput.value || 0);
    }
};

window.printQuotation = async (id) => {
    const q = await db.quotations.get(id);
    const clinicLogo = localStorage.getItem('clinicLogo');
    const clinicName = localStorage.getItem('clinicName') || 'Program Clinic';
    const clinicNIT = localStorage.getItem('clinicNIT') || '';
    const items = JSON.parse(q.items);

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Cotización - ${q.patientName}</title>
            <style>
                body { font-family: sans-serif; padding: 40px; color: #333; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #eee; padding-bottom: 20px; }
                .logo-img { max-height: 80px; }
                .clinic-info { text-align: right; }
                .target-info { margin: 30px 0; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th { background: #f8f9fa; text-align: left; padding: 12px; border-bottom: 2px solid #eee; }
                td { padding: 12px; border-bottom: 1px solid #eee; }
                .total { text-align: right; font-size: 1.5rem; font-weight: bold; margin-top: 30px; }
                .footer { margin-top: 50px; font-size: 0.8rem; color: #777; text-align: center; }
            </style>
        </head>
        <body>
            <div class="header">
                ${clinicLogo ? `<img src="${clinicLogo}" class="logo-img">` : '<div></div>'}
                <div class="clinic-info">
                    <h2>${clinicName}</h2>
                    <p>NIT: ${clinicNIT}</p>
                    <p>Fecha: ${q.date}</p>
                </div>
            </div>
            <div class="target-info">
                <h3>Cotización para:</h3>
                <p><strong>${q.patientName}</strong></p>
            </div>
            <table>
                <thead><tr><th>Cant</th><th>Descripción</th><th>Vr. Unitario</th><th>Total</th></tr></thead>
                <tbody>
                    ${items.map(i => `
                        <tr>
                            <td>${i.qty}</td>
                            <td>${i.desc}</td>
                            <td>$ ${parseInt(i.price).toLocaleString()}</td>
                            <td>$ ${parseInt(i.total).toLocaleString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="total">TOTAL: $ ${q.total.toLocaleString()}</div>
            <div class="footer">Esta cotización tiene una validez de 30 días.</div>
            <script>window.print();</script>
        </body>
        </html>
    `);
    printWindow.document.close();
};

window.deleteQuotation = async (id) => {
    if (confirm("¿Estás seguro de eliminar esta cotización?")) {
        await db.quotations.delete(id);
        renderQuotations();
    }
};

async function checkDailyAppointments() {
    const today = new Date().toISOString().split('T')[0];
    const appointments = await db.appointments.where('date').equals(today).toArray();
    
    if (appointments.length > 0) {
        if (Notification.permission === "granted") {
            new Notification("Recordatorio de Citas", {
                body: `Tienes ${appointments.length} citas programadas para hoy.`,
                icon: "/icon-192.png"
            });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    new Notification("Recordatorio de Citas", {
                        body: `Tienes ${appointments.length} citas programadas para hoy.`,
                        icon: "/icon-192.png"
                    });
                }
            });
        }
    }
}

window.checkBackupReminder = () => {
    const lastBackup = localStorage.getItem('lastBackupDate');
    if (!lastBackup) return;
    
    const lastDate = new Date(lastBackup);
    const now = new Date();
    const diffDays = Math.ceil((now - lastDate) / (1000 * 60 * 60 * 24));
    
    if (diffDays >= 7) {
        const notify = document.createElement('div');
        notify.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: var(--primary); color: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; gap: 1rem; border-left: 5px solid #f59e0b; animation: slideIn 0.3s ease-out;';
        notify.innerHTML = `
            <div style="flex: 1;">
                <p style="font-weight: bold; font-size: 1rem; margin-bottom: 0.25rem;">🛡️ Seguridad de Datos</p>
                <p style="font-size: 0.875rem; opacity: 0.9;">Han pasado ${diffDays} días desde tu último respaldo. ¡Evita pérdida de información!</p>
            </div>
            <button class="btn" style="background: white; color: var(--primary); font-weight: bold;" onclick="this.parentElement.remove(); switchView(\'settings\')">Hacer Backup</button>
            <button style="background: none; border: none; color: white; cursor: pointer; font-size: 1.5rem; line-height: 1;" onclick="this.parentElement.remove()">×</button>
        `;
        document.body.appendChild(notify);
    }
};

window.showPrescriptionSelector = async (targetFormId) => {
    const templates = await db.prescriptionTemplates.toArray();
    const modalContainer = document.getElementById('modal-container');
    
    modalContainer.innerHTML = `
        <div class="modal">
            <div class="modal-content" style="max-width: 600px; padding: 2rem; border-radius: 16px; background: var(--bg-card); border: 1px solid var(--border); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h3 style="font-size: 1.5rem; color: var(--primary);">Seleccionar Plantilla de Receta</h3>
                    <button class="btn-close" onclick="closeModal()" style="font-size: 1.5rem; color: var(--text-muted);">&times;</button>
                </div>
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <input type="text" id="template-search" placeholder="Buscar por procedimiento (ej: Exodoncia)..." 
                           style="width: 100%; padding: 0.85rem; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-main); font-size: 1rem;"
                           onkeyup="filterTemplates()">
                </div>
                <div id="templates-list" style="max-height: 400px; overflow-y: auto; padding-right: 5px;">
                    ${templates.map(t => `
                        <div class="template-item" style="padding: 1.25rem; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 0.75rem; cursor: pointer; transition: 0.3s; background: rgba(255,255,255,0.02);"
                             onclick="loadPrescriptionTemplate(${t.id}, '${targetFormId}')"
                             onmouseover="this.style.borderColor='var(--primary)'; this.style.background='rgba(79, 70, 229, 0.05)'"
                             onmouseout="this.style.borderColor='var(--border)'; this.style.background='rgba(255,255,255,0.02)'">
                            <strong style="color: var(--primary); display: block; margin-bottom: 0.5rem; font-size: 1.1rem;">${t.procedure}</strong>
                            <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;">${t.medicaments.substring(0, 100)}...</p>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top: 1.5rem; text-align: right;">
                    <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
                </div>
            </div>
        </div>
    `;
    modalContainer.classList.remove('hidden');

    window.filterTemplates = () => {
        const query = document.getElementById('template-search').value.toLowerCase();
        const items = document.querySelectorAll('.template-item');
        items.forEach(item => {
            const text = item.innerText.toLowerCase();
            item.style.display = text.includes(query) ? 'block' : 'none';
        });
    };
};

window.loadPrescriptionTemplate = async (templateId, targetFormId) => {
    const t = await db.prescriptionTemplates.get(templateId);
    if (!t) return;

    if (targetFormId === 'complex-history-form') {
        document.getElementById('diag-input').value = t.diagnosis;
        document.getElementById('meds-input').value = t.medicaments;
    } else if (targetFormId === 'edit-history-form') {
        document.getElementById('diag-input-edit').value = t.diagnosis;
        document.getElementById('meds-input-edit').value = t.medicaments;
    }
    
    closeModal();
};

window.closeModal = () => {
    document.getElementById('modal-container').classList.add('hidden');
};

window.generateMonthlyReport = async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const records = await db.records.toArray();
    const recentRecords = records.filter(r => {
        // Parse date DD/MM/YYYY
        const parts = r.date.split(',')[0].split('/');
        const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        return d >= thirtyDaysAgo;
    });

    const recentPatientIds = [...new Set(recentRecords.map(r => r.patientId))];
    const recentQuotes = await db.quotations.filter(q => {
        const parts = q.date.split(',')[0].split('/');
        const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        return d >= thirtyDaysAgo;
    }).toArray();

    const totalIncome = recentQuotes.reduce((acc, q) => acc + (q.total || 0), 0);
    const clinicName = localStorage.getItem('clinicName') || 'Program Clinic';

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Reporte Mensual - ${clinicName}</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 3rem; color: #1e293b; line-height: 1.6; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 1rem; margin-bottom: 2rem; }
                h1 { color: #4F46E5; margin: 0; }
                .metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin: 2rem 0; }
                .metric-card { padding: 1.5rem; border: 1px solid #e2e8f0; border-radius: 12px; text-align: center; background: #f8fafc; }
                .metric-value { font-size: 2rem; font-weight: bold; display: block; color: #4F46E5; margin-bottom: 0.5rem; }
                .metric-label { font-size: 0.875rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; }
                table { width: 100%; border-collapse: collapse; margin-top: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
                th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
                th { background: #f1f5f9; font-weight: 600; color: #475569; }
                tr:last-child td { border-bottom: none; }
                .footer { margin-top: 4rem; text-align: center; font-size: 0.875rem; color: #94a3b8; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h1>Reporte Mensual de Gestión</h1>
                    <p>Clínica: <strong>${clinicName}</strong></p>
                </div>
                <div style="text-align: right;">
                    <p>Periodo: ${thirtyDaysAgo.toLocaleDateString()} - ${new Date().toLocaleDateString()}</p>
                </div>
            </div>
            
            <div class="metric-grid">
                <div class="metric-card">
                    <span class="metric-value">${recentRecords.length}</span>
                    <span class="metric-label">Consultas</span>
                </div>
                <div class="metric-card">
                    <span class="metric-value">${recentPatientIds.length}</span>
                    <span class="metric-label">Pacientes Únicos</span>
                </div>
                <div class="metric-card">
                    <span class="metric-value">$ ${totalIncome.toLocaleString()}</span>
                    <span class="metric-label">Ingresos Proyectados</span>
                </div>
            </div>

            <h3>Resumen de Actividad Reciente</h3>
            <table>
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Paciente</th>
                        <th>Motivo de Consulta</th>
                    </tr>
                </thead>
                <tbody>
                    ${(await Promise.all(recentRecords.slice(0, 20).map(async r => {
                        const p = await db.patients.get(r.patientId);
                        const motive = await decryptData(r.motive);
                        return `<tr><td>${r.date.split(',')[0]}</td><td>${p ? (p.name + ' ' + p.surname1) : 'Eliminado'}</td><td>${motive}</td></tr>`;
                    }))).join('')}
                </tbody>
            </table>
            
            <div class="footer">
                Generado automáticamente por Program Clinic - Software de Gestión Odontológica Profesional
            </div>
            <script>window.print();</script>
        </body>
        </html>
    `);
    printWindow.document.close();
};

window.renderHelp = () => {
    const mainView = document.getElementById('main-view');
    mainView.innerHTML = `
        <div style="max-width: 800px; margin: 0 auto;">
            <h2 style="margin-bottom: 2rem;">📘 Guía de Inicio Rápido</h2>
            
            <div class="card" style="padding: 2rem; margin-bottom: 2rem;">
                <h3 style="color: var(--primary); margin-bottom: 1rem;">🛡️ Seguridad y Cifrado</h3>
                <p>Tus datos médicos están protegidos con cifrado de grado militar (AES-GCM). Esto significa que <strong>nadie</strong>, excepto quien posee la Llave Maestra, puede leer la información.</p>
                <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 1rem; margin: 1rem 0; border-radius: 4px;">
                    <strong>IMPORTANTE:</strong> La Llave Maestra se genera automáticamente en este dispositivo. Si usas la App en un nuevo computador, deberás ingresar la misma llave para ver los datos. Puedes encontrarla en <strong>Configuración</strong>.
                </div>
            </div>

            <div class="card" style="padding: 2rem; margin-bottom: 2rem;">
                <h3 style="color: var(--primary); margin-bottom: 1rem;">💾 Respaldos (Backups)</h3>
                <p>Aunque los datos se guardan automáticamente en tu navegador, te recomendamos hacer un respaldo manual cada semana:</p>
                <ol style="margin-left: 1.5rem; margin-top: 1rem;">
                    <li>Ve a <strong>Configuración</strong>.</li>
                    <li>Haz clic en <strong>"Exportar Base de Datos (JSON)"</strong>.</li>
                    <li>Guarda ese archivo en un lugar seguro (Google Drive, USB, etc.).</li>
                </ol>
            </div>

            <div class="card" style="padding: 2rem; margin-bottom: 2rem;">
                <h3 style="color: var(--primary); margin-bottom: 1rem;">📱 Instalación (PWA)</h3>
                <p>Esta aplicación funciona sin internet una vez instalada. Para una mejor experiencia:</p>
                <ul style="margin-left: 1.5rem; margin-top: 1rem;">
                    <li><strong>En Computador:</strong> Haz clic en el icono de instalación en la barra de direcciones o usa el botón "Instalar App" en el menú lateral.</li>
                    <li><strong>En Móvil:</strong> Usa la opción "Añadir a la pantalla de inicio" de tu navegador.</li>
                </ul>
            </div>

            <div class="card" style="padding: 2rem;">
                <h3 style="color: var(--primary); margin-bottom: 1rem;">🧪 Gestión de Pacientes</h3>
                <p>Para cada paciente puedes:</p>
                <ul style="margin-left: 1.5rem; margin-top: 1rem;">
                    <li>Gestionar su <strong>Odontograma</strong> interactivo.</li>
                    <li>Cargar <strong>Radiografías</strong> y adjuntos.</li>
                    <li>Generar <strong>Recetas Inteligentes</strong> basadas en procedimientos.</li>
                    <li>Imprimir el <strong>Consentimiento Informado</strong> legal.</li>
                </ul>
            </div>
        </div>
    `;
};

// PWA Installation Logic
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('install-pwa-btn');
    if (installBtn) installBtn.style.display = 'flex';
});

window.installApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        const installBtn = document.getElementById('install-pwa-btn');
        if (installBtn) installBtn.style.display = 'none';
    }
    deferredPrompt = null;
};

window.deleteRecordImage = async (recordId, imageIdx) => {
    if (!confirm('¿Estás seguro de eliminar esta imagen?')) return;
    
    const record = await db.records.get(recordId);
    if (record && record.attachments) {
        const newAttachments = [...record.attachments];
        newAttachments.splice(imageIdx, 1);
        await db.records.update(recordId, { attachments: newAttachments });
        // Refresh the current view
        viewPatientHistory(record.patientId);
    }
};

// Start the app
document.addEventListener('DOMContentLoaded', () => {
    try {
        init();
        lucide.createIcons();
    } catch (error) {
        console.error('Error initializing app:', error);
        document.getElementById('loading-msg').textContent = 'Error al iniciar el sistema. Por favor, asegúrate de abrirlo en un navegador moderno.';
        document.getElementById('loading-msg').style.color = 'var(--danger)';
    }
});
