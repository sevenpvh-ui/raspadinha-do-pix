document.addEventListener('DOMContentLoaded', () => {

    // ==========================================================
    // INICIALIZAÇÃO E SELETORES
    // ==========================================================
    
    // Conecta ao servidor da Raspadinha (que está em outra porta ou URL)
    let socket;
    try {
        socket = io();
        console.log("Conectado ao servidor Socket.IO (Raspadinha).");
    } catch (err) {
        console.error("Erro ao conectar ao Socket.IO (Raspadinha):", err);
        alert("Erro de conexão com o servidor. Recarregue a página.");
        const btnComprar = document.getElementById('btn-comprar-raspadinha');
        if (btnComprar) {
            btnComprar.disabled = true;
            btnComprar.textContent = "Erro de Conexão";
        }
    }

    // --- Variáveis Globais ---
    let PRECO_RASPADINHA_ATUAL = 2.00; // Padrão
    let PREMIO_MAXIMO_ATUAL = 100.00; // Padrão
    let currentPaymentId = null; // Guarda o ID do pagamento atual

    // --- Seletores do DOM (Página Principal) ---
    const cardComprar = document.getElementById('card-comprar-raspadinha');
    const cardJogo = document.getElementById('card-area-jogo');
    const btnComprarRaspadinha = document.getElementById('btn-comprar-raspadinha');
    const raspadinhaPrecoEl = document.getElementById('raspadinha-preco');
    const raspadinhaPremioMaximoEl = document.getElementById('raspadinha-premio-maximo');
    
    // --- Seletores do DOM (Área de Jogo) ---
    const raspadinhaContainer = document.getElementById('raspadinha-container');
    const raspadinhaFundo = document.getElementById('raspadinha-fundo');
    const raspadinhaTextoPremio = document.getElementById('raspadinha-texto-premio');
    const raspadinhaStatus = document.getElementById('raspadinha-status');
    const btnJogarNovamente = document.getElementById('btn-jogar-novamente');

    // --- Seletores do DOM (Modal de Pagamento) ---
    const modal = document.getElementById('modal-checkout');
    const btnCloseModal = document.querySelector('.modal-close');
    const etapaDados = document.getElementById('etapa-dados');
    const etapaPix = document.getElementById('etapa-pix');
    const btnGerarPix = document.getElementById('btn-gerar-pix'); 
    const btnCopiarPix = document.getElementById('btn-copiar-pix'); 
    const pixQrCodeImg = document.getElementById('pix-qrcode-img');
    const pixCopiaColaInput = document.getElementById('pix-copia-cola');
    const aguardandoPagamentoEl = document.getElementById('aguardando-pagamento');
    const modalNome = document.getElementById('modal-nome');
    const modalTelefone = document.getElementById('modal-telefone');
    const modalPrecoEl = document.getElementById('modal-preco');

    // --- Seletores do DOM (Consultar Prêmios) ---
    const formRecuperar = document.getElementById('form-recuperar-premios');
    const inputTelefoneRecuperar = document.getElementById('modal-telefone-recuperar');
    const btnChecarPremios = document.getElementById('btn-checar-premios');

    // Função para formatar valor BRL
    function formatarBRL(valor) {
        const numero = parseFloat(valor);
        if (isNaN(numero)) return 'R$ --,--';
        return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    // ==========================================================
    // 1. BUSCAR CONFIGURAÇÕES INICIAIS (PREÇO)
    // ==========================================================
    async function carregarConfig() {
        try {
            const response = await fetch('/api/raspadinha/config');
            if (!response.ok) throw new Error('Erro ao buscar config.');
            
            const data = await response.json();
            if (data.success) {
                PRECO_RASPADINHA_ATUAL = parseFloat(data.preco || '2.00');
                PREMIO_MAXIMO_ATUAL = parseFloat(data.premioMaximo || '100.00');
                
                // Atualiza os textos na página
                if (raspadinhaPrecoEl) raspadinhaPrecoEl.textContent = formatarBRL(PRECO_RASPADINHA_ATUAL);
                if (raspadinhaPremioMaximoEl) raspadinhaPremioMaximoEl.textContent = formatarBRL(PREMIO_MAXIMO_ATUAL);
                if (modalPrecoEl) modalPrecoEl.textContent = formatarBRL(PRECO_RASPADINHA_ATUAL);
            }
        } catch (err) {
            console.error(err);
            if(cardComprar) cardComprar.innerHTML = "<h2>Erro ao carregar. Tente recarregar a página.</h2>";
        }
    }
    carregarConfig(); // Carrega assim que a página abre

    // ==========================================================
    // 2. LÓGICA DO MODAL DE PAGAMENTO
    // ==========================================================
    
    if (btnComprarRaspadinha) {
        btnComprarRaspadinha.addEventListener('click', () => {
            if (!socket || !socket.connected) {
                alert("Erro de conexão com o servidor. Por favor, recarregue a página.");
                return;
            }
            modal.style.display = 'flex';
            modalNome.focus();
        });
    }
    
    if (btnCloseModal) btnCloseModal.addEventListener('click', fecharModal);
    if (modal) modal.addEventListener('click', (event) => { if (event.target === modal) fecharModal(); });

    function fecharModal() { 
        if(modal) modal.style.display = 'none'; 
        if(etapaDados) etapaDados.style.display = 'block';
        if(etapaPix) etapaPix.style.display = 'none';
        if(btnGerarPix) { 
            btnGerarPix.disabled = false; 
            btnGerarPix.textContent = "Gerar PIX"; 
        }
        currentPaymentId = null; // Limpa o ID de pagamento
    }

    if (btnGerarPix) {
        btnGerarPix.addEventListener('click', async () => {
            const nome = modalNome.value.trim();
            const telefone = modalTelefone.value.trim();
            
            if (!nome || !telefone) {
                alert("Preencha todos os campos."); return;
            }
            if (!/^\d{10,11}$/.test(telefone.replace(/\D/g,''))) {
                alert("Telefone inválido. Insira DDD + Número (só números)."); return;
            }

            if (!socket || !socket.id) {
                alert("Erro de conexão. Por favor, recarregue a página e tente novamente.");
                return;
            }

            btnGerarPix.textContent = "Gerando..."; 
            btnGerarPix.disabled = true;

            try {
                const response = await fetch('/api/raspadinha/criar-pagamento', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-Socket-ID': socket.id // Envia o ID do Socket para o servidor
                    },
                    body: JSON.stringify({ nome, telefone }),
                });

                const data = await response.json();
                
                if (data && data.success) {
                    pixQrCodeImg.src = `data:image/png;base64,${data.qrCodeBase64}`;
                    pixCopiaColaInput.value = data.qrCodeCopiaCola;
                    
                    etapaDados.style.display = 'none';
                    etapaPix.style.display = 'block';
                    aguardandoPagamentoEl.style.display = 'block';
                    
                    // Salva os dados para o jogo e para consulta
                    sessionStorage.setItem('raspadinha_usuario_nome', nome); 
                    sessionStorage.setItem('raspadinha_usuario_telefone', telefone);
                    currentPaymentId = data.paymentId; // Salva o ID do pagamento atual

                } else {
                    alert(`Erro: ${data.message || 'Não foi possível gerar o PIX.'}`);
                    btnGerarPix.textContent = "Gerar PIX"; 
                    btnGerarPix.disabled = false;
                }
            } catch (err) {
                console.error("Erro ao gerar PIX:", err);
                alert("Erro de conexão. Tente novamente.");
                btnGerarPix.textContent = "Gerar PIX"; 
                btnGerarPix.disabled = false;
            }
        });
    }

    if(btnCopiarPix) {
        btnCopiarPix.addEventListener('click', () => {
            pixCopiaColaInput.select();
            try {
                navigator.clipboard.writeText(pixCopiaColaInput.value);
                btnCopiarPix.textContent = "Copiado!";
                setTimeout(() => { btnCopiarPix.textContent = "Copiar Código"; }, 2000);
            } catch (err) {
                alert('Não foi possível copiar o código. Selecione manualmente.');
            }
        });
    }

    // ==========================================================
    // 3. OUVINTES DO SOCKET.IO (APROVAÇÃO)
    // ==========================================================

    if (socket) {

        socket.on('connect', () => {
            console.log(`Conectado ao servidor Socket.IO com ID: ${socket.id}`);
        });

        socket.on('disconnect', () => {
            console.warn("Desconectado do servidor Socket.IO.");
        });
        
        // Ouve a atualização de preço vinda do Admin
        socket.on('configAtualizada', (data) => {
            console.log("Configuração recebida via socket:", data);
            if (data.preco) {
                PRECO_RASPADINHA_ATUAL = parseFloat(data.preco);
                if (raspadinhaPrecoEl) raspadinhaPrecoEl.textContent = formatarBRL(PRECO_RASPADINHA_ATUAL);
                if (modalPrecoEl) modalPrecoEl.textContent = formatarBRL(PRECO_RASPADINHA_ATUAL);
            }
            if (data.premioMaximo) {
                PREMIO_MAXIMO_ATUAL = parseFloat(data.premioMaximo);
                if (raspadinhaPremioMaximoEl) raspadinhaPremioMaximoEl.textContent = formatarBRL(PREMIO_MAXIMO_ATUAL);
            }
        });

        // ==========================================================
        // --- INÍCIO DA CORREÇÃO ---
        // ==========================================================
        // OUVINTE PRINCIPAL! O servidor avisa que o pagamento foi aprovado.
        socket.on('pagamentoAprovado', (data) => {
            // Verifica se o pagamento aprovado é o que estamos esperando
            // O 'data' AGORA CONTÉM { paymentId: "...", valorPremio: 0.00 }
            if (data.paymentId === currentPaymentId) {
                console.log("Meu pagamento foi aprovado!", data);
                
                // 1. Fecha o modal de pagamento
                fecharModal();
                
                // 2. Esconde o card de compra
                if (cardComprar) cardComprar.style.display = 'none';
                if (formRecuperar) formRecuperar.closest('.card').style.display = 'none';
                
                // 3. Mostra o card do jogo
                if (cardJogo) cardJogo.style.display = 'block';

                // 4. Inicia a "raspagem" PASSANDO O PRÊMIO que o servidor já nos enviou
                // Isso evita a "condição de corrida"
                iniciarRaspadinha(data.valorPremio); 
            }
        });
        // ==========================================================
        // --- FIM DA CORREÇÃO ---
        // ==========================================================

    } // Fecha o "if (socket)"

    // ==========================================================
    // 4. LÓGICA DO JOGO (RASPADINHA)
    // ==========================================================

    // ==========================================================
    // --- INÍCIO DA CORREÇÃO ---
    // ==========================================================
    // A função agora recebe o 'valorPremio' direto, e não precisa mais do 'paymentId'
    // Ela também não é mais 'async' e não faz 'fetch'
    function iniciarRaspadinha(valorPremio) {
        if (!raspadinhaContainer) return;

        try {
            // 1. Configura o prêmio "escondido" (o valor já veio do socket)
            if (valorPremio > 0) {
                raspadinhaFundo.classList.remove('nao-ganhou');
                raspadinhaTextoPremio.textContent = formatarBRL(valorPremio);
            } else {
                raspadinhaFundo.classList.add('nao-ganhou');
                raspadinhaTextoPremio.textContent = "Não foi dessa vez!";
            }

            // 2. Inicializa a biblioteca ScratchCard
            const sc = new ScratchCard('#raspadinha-container', {
                scratchType: SCRATCH_TYPE.LINE,
                containerWidth: raspadinhaContainer.clientWidth,
                containerHeight: raspadinhaContainer.clientWidth * 0.5625, // Força 16:9
                imageForwardSrc: 'imagem-raspadinha.png', // Imagem de "tinta"
                imageBackgroundSrc: '', // O fundo é o nosso HTML (raspadinha-fundo)
                clearZoneRadius: 30, // Tamanho da "moeda"
                percentToFinish: 70, // Precisa raspar 70% para revelar
                callback: () => {
                    // Função chamada quando raspa 70%
                    if (valorPremio > 0) {
                        raspadinhaStatus.textContent = `PARABÉNS! Você ganhou ${formatarBRL(valorPremio)}!`;
                        raspadinhaStatus.style.color = "var(--color-raspadinha-gold)";
                    } else {
                        raspadinhaStatus.textContent = "Que pena! Tente novamente!";
                        raspadinhaStatus.style.color = "var(--color-text-body)";
                    }
                    btnJogarNovamente.style.display = 'block';
                }
            });

            // Inicia a raspadinha
            sc.init().then(() => {
                console.log("Raspadinha iniciada com sucesso.");
            }).catch((err) => {
                // Isso vai pegar se a imagem 'imagem-raspadinha.png' falhar
                throw new Error(`Falha ao carregar imagem da raspadinha: ${err.message}`);
            });

        } catch (err) {
            // Se qualquer coisa der errado (buscar prêmio, iniciar raspadinha), caímos aqui
            console.error("Erro ao iniciar raspadinha:", err);
            raspadinhaStatus.textContent = "Erro ao carregar seu jogo. Atualize a página.";
            raspadinhaStatus.style.color = "red";
        }
    }
    // ==========================================================
    // --- FIM DA CORREÇÃO ---
    // ==========================================================


    // ==========================================================
    // 5. LÓGICA DE CONSULTAR PRÊMIOS
    // ==========================================================
    
    let modalPremios = null; // Guarda a referência do modal
    
    if (formRecuperar) {
        formRecuperar.addEventListener('submit', async (e) => {
            e.preventDefault();
            const telefone = inputTelefoneRecuperar.value.trim();
            if (!/^\d{10,11}$/.test(telefone.replace(/\D/g,''))) {
                alert("Telefone inválido. Digite apenas números, incluindo o DDD.");
                return;
            }

            btnChecarPremios.disabled = true;
            btnChecarPremios.textContent = 'Buscando...';

            try {
                const response = await fetch('/api/raspadinha/checar-premios', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ telefone: telefone }),
                });
                const data = await response.json();
                
                if (data.success) {
                    criarModalPremios(data.premios);
                } else {
                    alert(data.message || "Erro ao buscar prêmios.");
                }

            } catch (err) {
                alert("Erro de conexão. Tente novamente.");
            } finally {
                btnChecarPremios.disabled = false;
                btnChecarPremios.textContent = 'Verificar Prêmios';
            }
        });
    }

    function criarModalPremios(premios) {
        if (modalPremios) modalPremios.remove(); // Remove modal antigo

        modalPremios = document.createElement('div');
        modalPremios.classList.add('modal-overlay');
        modalPremios.style.display = 'flex';

        let htmlInterno = `
            <div class="modal-content" style="max-width: 600px;">
                <span class="modal-close" id="modal-premios-fechar">&times;</span>
                <h2 class="title-gradient">Meus Prêmios (Raspadinha)</h2>
                <div id="modal-meus-premios-lista">
        `;

        if (premios && premios.length > 0) {
            htmlInterno += `<p style="text-align: center; font-weight: bold; font-size: 1.1em; color: var(--color-raspadinha-gold);">Encontramos ${premios.length} prêmio(s) no seu número!</p>`;
            premios.forEach(premio => {
                const statusClasse = premio.status_pagamento_premio === 'Pendente' ? 'status-pendente' : 'status-pago';
                htmlInterno += `
                    <div class="premio-encontrado-item" style="border-left: 4px solid var(--color-raspadinha-gold);">
                        <div class="premio-info-wrapper">
                            <span class="premio-valor-consulta">${formatarBRL(premio.valor_premio)}</span>
                            <span class="premio-data-consulta">Ganho em: ${premio.data_formatada}</span>
                        </div>
                        <span class="status-pagamento ${statusClasse}">${premio.status_pagamento_premio}</span>
                    </div>
                `;
            });
            htmlInterno += `<p style="text-align: center; margin-top: 15px; font-size: 0.9em;">Se o status estiver "Pendente", entre em contato com a administração para receber.</p>`;
        } else {
            htmlInterno += `<p>Nenhum prêmio encontrado para este telefone.</p>`;
        }

        htmlInterno += `
                </div>
            </div>
        `;
        modalPremios.innerHTML = htmlInterno;
        document.body.appendChild(modalPremios);

        modalPremios.addEventListener('click', (e) => {
            if (e.target.id === 'modal-premios-fechar' || e.target === modalPremios) {
                modalPremios.remove();
                modalPremios = null;
            }
        });
    }

});
