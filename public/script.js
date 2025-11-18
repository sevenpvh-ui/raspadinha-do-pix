document.addEventListener('DOMContentLoaded', () => {

    // ==========================================================
    // CONFIGURAÇÃO INICIAL
    // ==========================================================
    
    let socket;
    try {
        socket = io();
        console.log("Conectado ao servidor Socket.IO.");
    } catch (err) {
        console.error("Erro Socket.IO:", err);
        const btn = document.getElementById('btn-comprar-raspadinha');
        if (btn) { btn.disabled = true; btn.textContent = "Erro de Conexão"; }
    }

    let PRECO_RASPADINHA_ATUAL = 1.00;
    let PREMIO_MAXIMO_ATUAL = 100.00;

    // Seletores Principais
    const cardComprar = document.getElementById('card-comprar-raspadinha');
    const cardJogo = document.getElementById('card-area-jogo');
    const btnComprar = document.getElementById('btn-comprar-raspadinha');
    const raspadinhaContainer = document.getElementById('raspadinha-container');
    const raspadinhaFundo = document.getElementById('raspadinha-fundo');
    const raspadinhaTexto = document.getElementById('raspadinha-texto-premio');
    const raspadinhaStatus = document.getElementById('raspadinha-status');
    const btnJogarNovamente = document.getElementById('btn-jogar-novamente');

    // Seletores Modal
    const modal = document.getElementById('modal-checkout');
    const btnCloseModal = document.querySelector('.modal-close');
    const etapaDados = document.getElementById('etapa-dados');
    const etapaPix = document.getElementById('etapa-pix');
    const btnGerarPix = document.getElementById('btn-gerar-pix'); 
    const btnCopiarPix = document.getElementById('btn-copiar-pix'); 
    const modalNome = document.getElementById('modal-nome');
    const modalTelefone = document.getElementById('modal-telefone');
    
    // Seletores Form Prêmios
    const formRecuperar = document.getElementById('form-recuperar-premios');
    const inputTelefoneRecuperar = document.getElementById('modal-telefone-recuperar');

    // Formatação BRL
    const formatarBRL = (v) => parseFloat(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // 1. Carregar Config
    async function carregarConfig() {
        try {
            const res = await fetch('/api/raspadinha/config');
            const data = await res.json();
            if (data.success) {
                PRECO_RASPADINHA_ATUAL = parseFloat(data.preco);
                PREMIO_MAXIMO_ATUAL = parseFloat(data.premioMaximo);
                document.getElementById('raspadinha-preco').textContent = formatarBRL(PRECO_RASPADINHA_ATUAL);
                document.getElementById('raspadinha-premio-maximo').textContent = formatarBRL(PREMIO_MAXIMO_ATUAL);
                document.getElementById('modal-preco').textContent = formatarBRL(PRECO_RASPADINHA_ATUAL);
            }
        } catch (e) { console.error(e); }
    }
    carregarConfig();

    // 2. Modal e Compra
    if (btnComprar) {
        btnComprar.addEventListener('click', () => {
            if (!socket?.connected) return alert("Sem conexão.");
            modal.style.display = 'flex'; modalNome.focus();
        });
    }
    if (btnCloseModal) btnCloseModal.addEventListener('click', fecharModal);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) fecharModal(); });

    function fecharModal() { 
        modal.style.display = 'none'; 
        etapaDados.style.display = 'block'; 
        etapaPix.style.display = 'none';
        btnGerarPix.disabled = false; btnGerarPix.textContent = "Gerar PIX";
        sessionStorage.removeItem('raspadinha_payment_id');
    }

    if (btnGerarPix) {
        btnGerarPix.addEventListener('click', async () => {
            const nome = modalNome.value.trim();
            const telefone = modalTelefone.value.trim();
            if (!nome || !telefone) return alert("Preencha tudo.");
            
            btnGerarPix.textContent = "Gerando..."; btnGerarPix.disabled = true;

            try {
                const res = await fetch('/api/raspadinha/criar-pagamento', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Socket-ID': socket.id },
                    body: JSON.stringify({ nome, telefone }),
                });
                const data = await res.json();
                if (data.success) {
                    document.getElementById('pix-qrcode-img').src = `data:image/png;base64,${data.qrCodeBase64}`;
                    document.getElementById('pix-copia-cola').value = data.qrCodeCopiaCola;
                    
                    etapaDados.style.display = 'none'; 
                    etapaPix.style.display = 'block';
                    document.getElementById('aguardando-pagamento').style.display = 'block';
                    
                    sessionStorage.setItem('raspadinha_payment_id', data.paymentId);
                } else {
                    alert(data.message); btnGerarPix.disabled = false;
                }
            } catch (e) { alert("Erro conexão."); btnGerarPix.disabled = false; }
        });
    }

    if (btnCopiarPix) {
        btnCopiarPix.addEventListener('click', () => {
            const input = document.getElementById('pix-copia-cola');
            input.select();
            navigator.clipboard.writeText(input.value);
            btnCopiarPix.textContent = "Copiado!";
            setTimeout(() => btnCopiarPix.textContent = "Copiar Código", 2000);
        });
    }

    // 3. Socket Listeners
    if (socket) {
        socket.on('connect', checarPagamentoPendente);
        
        socket.on('pagamentoAprovado', (data) => {
            if (data.paymentId === sessionStorage.getItem('raspadinha_payment_id')) {
                sessionStorage.removeItem('raspadinha_payment_id');
                fecharModal();
                prepararJogo(data.valorPremio);
            }
        });
    }

    async function checarPagamentoPendente() {
        const pid = sessionStorage.getItem('raspadinha_payment_id');
        if (!pid) return;
        try {
            const res = await fetch('/api/raspadinha/checar-pagamento', {
                method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({paymentId: pid})
            });
            const data = await res.json();
            if (data.success) {
                sessionStorage.removeItem('raspadinha_payment_id');
                fecharModal();
                prepararJogo(data.valorPremio);
            }
        } catch(e) {}
    }

    function prepararJogo(valorPremio) {
        if (cardComprar) cardComprar.style.display = 'none';
        if (formRecuperar) formRecuperar.closest('.card').style.display = 'none';
        if (cardJogo) cardJogo.style.display = 'block';
        
        // Inicia a raspadinha
        iniciarRaspadinha(valorPremio);
    }

    // ==========================================================
    // 4. LÓGICA DO JOGO (CORRIGIDA)
    // ==========================================================
    function iniciarRaspadinha(valorPremio) {
        if (!raspadinhaContainer) return;

        // Aguarda renderização
        requestAnimationFrame(() => {
            try {
                // 1. Configura o prêmio (fundo)
                if (valorPremio > 0) {
                    raspadinhaFundo.classList.remove('nao-ganhou');
                    raspadinhaTexto.textContent = formatarBRL(valorPremio);
                } else {
                    raspadinhaFundo.classList.add('nao-ganhou');
                    raspadinhaTexto.textContent = "Não foi dessa vez!";
                }

                const width = raspadinhaContainer.clientWidth;
                if (width === 0) return console.error("Largura 0");

                // Remove canvas antigo se houver
                const oldCanvas = raspadinhaContainer.querySelector('canvas');
                if(oldCanvas) oldCanvas.remove();

                // 2. Inicia ScratchCard
                const sc = new ScratchCard('#raspadinha-container', {
                    scratchType: ScratchCard.SCRATCH_TYPE.SPRAY, // TIPO SPRAY É MELHOR
                    containerWidth: width,
                    containerHeight: width * 0.5625, // 16:9
                    imageForwardSrc: '/imagem-raspadinha.png', // CAMINHO ABSOLUTO (COM BARRA)
                    htmlBackground: '', 
                    clearZoneRadius: 40,
                    nPoints: 100,
                    pointSize: 4,
                    callback: () => {
                        if (valorPremio > 0) {
                            raspadinhaStatus.textContent = `PARABÉNS! Ganhou ${formatarBRL(valorPremio)}!`;
                            raspadinhaStatus.style.color = "var(--color-raspadinha-gold)";
                        } else {
                            raspadinhaStatus.textContent = "Que pena! Tente novamente!";
                        }
                        btnJogarNovamente.style.display = 'block';
                    }
                });

                sc.init()
                    .then(() => console.log("Raspadinha carregada!"))
                    .catch((err) => {
                        console.error("Erro imagem:", err);
                        raspadinhaStatus.innerHTML = "Erro ao carregar imagem.<br>Verifique se o arquivo <b>imagem-raspadinha.png</b> existe na pasta public.";
                        raspadinhaStatus.style.color = "red";
                    });

            } catch (e) { console.error("Erro fatal:", e); }
        });
    }

    // 5. Consultar Prêmios (Código mantido, simplificado)
    if (formRecuperar) {
        formRecuperar.addEventListener('submit', async (e) => {
            e.preventDefault();
            const tel = inputTelefoneRecuperar.value.trim();
            try {
                const res = await fetch('/api/raspadinha/checar-premios', {
                     method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({telefone:tel})
                });
                const data = await res.json();
                if(data.success) mostrarPremios(data.premios);
                else alert(data.message);
            } catch(e){ alert("Erro conexão"); }
        });
    }

    function mostrarPremios(lista) {
        const div = document.createElement('div');
        div.className = 'modal-overlay';
        div.style.display = 'flex';
        
        let html = `<div class="modal-content" style="max-width:600px;">
            <span class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</span>
            <h2 class="title-gradient">Seus Prêmios</h2><div id="modal-meus-premios-lista">`;
            
        if(lista.length){
            lista.forEach(p => {
                html += `<div class="premio-encontrado-item">
                    <div class="premio-info-wrapper">
                        <span class="premio-valor-consulta">${formatarBRL(p.valor_premio)}</span>
                        <span class="premio-data-consulta">${p.data_formatada}</span>
                    </div>
                    <span class="status-pagamento ${p.status_pagamento_premio === 'Pendente' ? 'status-pendente' : 'status-pago'}">${p.status_pagamento_premio}</span>
                </div>`;
            });
        } else { html += "<p>Nada encontrado.</p>"; }
        
        html += "</div></div>";
        div.innerHTML = html;
        document.body.appendChild(div);
        div.onclick = (e) => { if(e.target === div) div.remove(); }
    }
});
