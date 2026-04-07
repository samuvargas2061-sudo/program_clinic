window.printPrescription = async (recordId) => {
    const r = await window.db.records.get(recordId);
    const p = await window.db.patients.get(r.patientId);
    const clinicLogo = localStorage.getItem('clinicLogo');
    const clinicName = localStorage.getItem('clinicName') || 'Program Clinic';
    const clinicNIT = localStorage.getItem('clinicNIT') || '';
    
    const dDiag = await decryptData(r.diagnosis);
    const dMeds = await decryptData(r.medicaments);
    const dMotive = await decryptData(r.motive);

    // Extract treatment plan items / medicaments
    let planContent = '';
    if (dMeds) {
        planContent = `<div style="background: #f1f5f9; padding: 15px; border-radius: 8px; border: 1px dashed #cbd5e1; white-space: pre-line;">${dMeds}</div>`;
    } else if (r.plan_desc_0) {
        planContent = '<ul>';
        for (let i = 0; i < 10; i++) {
            if (r[`plan_desc_${i}`]) {
                planContent += `<li>${r[`plan_qty_${i}`] || 1}x ${r[`plan_desc_${i}`]}</li>`;
            }
        }
        planContent += '</ul>';
    } else {
        const dPlan = await decryptData(r.treatmentPlan || '');
        planContent = `<p>${dPlan}</p>`;
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Recetario - ${p.name} ${p.surname1}</title>
            <style>
                @page { size: letter; margin: 2cm; }
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; line-height: 1.6; }
                .header { display: flex; justify-content: space-between; align-items: start; border-bottom: 3px solid var(--primary, #0ea5e9); padding-bottom: 20px; margin-bottom: 30px; }
                .logo { max-height: 90px; max-width: 250px; }
                .clinic-info { text-align: right; }
                .clinic-info h1 { margin: 0; color: #0ea5e9; font-size: 1.8rem; }
                .patient-box { background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; border: 1px solid #e2e8f0; }
                .patient-box div span { font-weight: bold; color: #64748b; font-size: 0.8rem; text-transform: uppercase; display: block; }
                .prescription-body { min-height: 400px; padding: 0 10px; }
                .section-title { color: #0ea5e9; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-top: 25px; margin-bottom: 10px; font-weight: bold; text-transform: uppercase; font-size: 0.9rem; }
                .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #eee; display: flex; justify-content: space-between; font-size: 0.8rem; color: #64748b; }
                .signature-box { margin-top: 80px; width: 250px; border-top: 1px solid #333; text-align: center; padding-top: 5px; }
                ul { padding-left: 20px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo-box">
                    ${clinicLogo ? `<img src="${clinicLogo}" class="logo">` : `<div style="font-size: 2rem; font-weight: bold; color: #0ea5e9;">${clinicName}</div>`}
                </div>
                <div class="clinic-info">
                    <h1>${clinicName}</h1>
                    <p>${clinicNIT ? `NIT: ${clinicNIT}` : ''}</p>
                    <p>HISTORIA CLÍNICA ODONTOLÓGICA</p>
                </div>
            </div>

            <div class="patient-box">
                <div><span>Paciente:</span> ${p.name} ${p.surname1} ${p.surname2 || ''}</div>
                <div><span>Documento:</span> ${p.document}</div>
                <div><span>Fecha:</span> ${r.date}</div>
                <div><span>Motivo:</span> ${dMotive}</div>
            </div>

            <div class="prescription-body">
                <div class="section-title">Diagnóstico</div>
                <p><strong>${dDiag}</strong></p>

                <div class="section-title">Prescripción de Medicamentos / Plan de Tratamiento</div>
                ${planContent}

                <div class="section-title">Observaciones adicionales</div>
                <p>${await decryptData(r.observations) || 'Ninguna'}</p>
            </div>

            <div class="footer">
                <div class="signature-box">
                    <strong>Firma del Profesional</strong><br>
                    Registro Médico / Odontológico
                </div>
                <div style="text-align: right;">
                    <p>Generado por Program Clinic Pro</p>
                    <p>Software de Gestión Odontológica</p>
                </div>
            </div>

            <script>
                const primaryColor = "${localStorage.getItem('primaryColor') || '#0ea5e9'}";
                document.body.style.setProperty('--primary', primaryColor);
                window.print();
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
};

window.printConsent = async (patientId) => {
    const p = await window.db.patients.get(patientId);
    const clinicName = localStorage.getItem('clinicName') || 'Program Clinic';
    const clinicNIT = localStorage.getItem('clinicNIT') || '';
    const date = new Date().toLocaleDateString();

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Consentimiento - ${p.name}</title>
            <style>
                @page { size: letter; margin: 2.5cm; }
                body { font-family: 'Times New Roman', Times, serif; line-height: 1.5; color: #333; text-align: justify; padding: 2rem; }
                .header { text-align: center; margin-bottom: 2rem; border-bottom: 1px solid #000; padding-bottom: 1rem; }
                .title { font-weight: bold; font-size: 1.1rem; text-transform: uppercase; margin-bottom: 1.5rem; display: block; text-align: center; }
                .content-section { margin-bottom: 1rem; }
                .signature-section { margin-top: 4rem; display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; }
                .line { border-top: 1px solid #000; padding-top: 0.5rem; text-align: center; }
            </style>
        </head>
        <body>
            <div class="header">
                <strong>${clinicName}</strong><br>
                ${clinicNIT ? `NIT: ${clinicNIT}<br>` : ''}
                Documento de Consentimiento Informado
            </div>

            <span class="title">CONSENTIMIENTO INFORMADO PARA TRATAMIENTO Y MANEJO DE DATOS</span>

            <div class="content-section">
                Yo, <strong>${p.name} ${p.surname1} ${p.surname2 || ''}</strong>, identificado(a) con No. <strong>${p.document}</strong>, autorizo a <strong>${clinicName}</strong> para realizar el tratamiento odontológico requerido.
            </div>

            <div class="content-section">
                <strong>PROTECCIÓN DE DATOS (LEY 1581):</strong> Autorizo el tratamiento de mis datos personales y de salud para fines exclusivos de mi atención médica. Entiendo que mi información está protegida por ley y que puedo ejercer mis derechos de actualización y rectificación.
            </div>

            <div class="content-section">
                He sido informado de los riesgos y beneficios. Firmo a los ${new Date().getDate()} días de ${new Intl.DateTimeFormat('es-CO', {month: 'long'}).format(new Date())} del ${new Date().getFullYear()}.
            </div>

            <div class="signature-section">
                <div class="line">Firma del Paciente<br>C.C. ${p.document}</div>
                <div class="line">Firma del Profesional</div>
            </div>
            <script>window.print();</script>
        </body>
        </html>
    `);
    printWindow.document.close();
};
