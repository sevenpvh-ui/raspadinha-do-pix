document.addEventListener('DOMContentLoaded', () => {
    let socket;
    try { socket = io(); } catch (e) { console.error(e); }

    const modal = document.getElementById('modal-checkout');
    const btnSimular = document.getElementById('btn-simular-compra'); // Botão novo
    
    // --- 1. BOTÃO DE SIMULAÇÃO (TESTE) ---
    if (btnSimular) {
        btnSimular.addEventListener('click', async () => {
            if (!socket || !socket.id) return alert("Sem conexão Socket.IO");
            
            const nome = document.getElementById('modal-nome').value || "Testador";
            const telefone = document.getElementById('modal-telefone').value || "99999999999";
            // Gera um ID falso para o teste
            const fakePaymentId = "teste_" + Date.now();
            
            // Salva no storage como se fosse real
            sessionStorage.setItem('raspadinha_payment_id', fakePaymentId);
            
            btnSimular.textContent = "Simulando...";
            btnSimular.disabled = true;

            try {
                // Chama a rota de debug do servidor
                await fetch('/api/debug/simular', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ socketId: socket.id, nome, telefone, paymentId: fakePaymentId })
                });
                // O servidor vai emitir 'pagamentoAprovado' e o código abaixo vai pegar
            } catch (err) {
                alert("Erro ao simular: " + err.message);
                btnSimular.disabled = false;
                btnSimular.textContent = "[TESTE] Simular Compra Grátis";
            }
        });
    }

    // --- 2. LÓGICA PADRÃO ---
    const btnComprar = document.getElementById('btn-comprar-raspadinha');
    if (btnComprar) {
        btnComprar.addEventListener('click', () => {
            modal.style.display = 'flex';
            if(btnSimular) { btnSimular.disabled = false; btnSimular.textContent = "[TESTE] Simular Compra Grátis"; }
        });
    }
    
    document.querySelector('.modal-close').addEventListener('click', () => { modal.style.display = 'none'; });
    
    // Gerar PIX Real
    const btnGerarPix = document.getElementById('btn-gerar-pix');
    if (btnGerarPix) {
        btnGerarPix.addEventListener('click', async () => {
            const nome = document.getElementById('modal-nome').value;
            const telefone = document.getElementById('modal-telefone').value;
            if(!nome || !telefone) return alert("Preencha os dados.");
            
            btnGerarPix.disabled = true; btnGerarPix.textContent = "Gerando...";
            
            try {
                const res = await fetch('/api/raspadinha/criar-pagamento', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', 'X-Socket-ID': socket.id},
                    body: JSON.stringify({nome, telefone})
                });
                const data = await res.json();
                if(data.success) {
                    document.getElementById('etapa-dados').style.display = 'none';
                    document.getElementById('etapa-pix').style.display = 'block';
                    document.getElementById('pix-qrcode-img').src = `data:image/png;base64,${data.qrCodeBase64}`;
                    document.getElementById('pix-copia-cola').value = data.qrCodeCopiaCola;
                    sessionStorage.setItem('raspadinha_payment_id', data.paymentId);
                } else { alert(data.message); btnGerarPix.disabled = false; }
            } catch(e) { alert("Erro."); btnGerarPix.disabled = false; }
        });
    }

    // --- 3. RECEBE APROVAÇÃO (Real ou Simulada) ---
    if (socket) {
        socket.on('pagamentoAprovado', (data) => {
            if (data.paymentId === sessionStorage.getItem('raspadinha_payment_id')) {
                sessionStorage.removeItem('raspadinha_payment_id');
                modal.style.display = 'none';
                document.getElementById('card-comprar-raspadinha').style.display = 'none';
                document.getElementById('card-area-jogo').style.display = 'block';
                
                // Inicia o jogo com o prêmio recebido
                iniciarRaspadinha(data.valorPremio);
            }
        });
    }

    // --- 4. INICIAR RASPADINHA (Com Força Bruta na Imagem) ---
    function iniciarRaspadinha(valorPremio) {
        const container = document.getElementById('raspadinha-container');
        const fundo = document.getElementById('raspadinha-fundo');
        const texto = document.getElementById('raspadinha-texto-premio');
        const status = document.getElementById('raspadinha-status');
        
        // Configura prêmio
        if (valorPremio > 0) {
            fundo.classList.remove('nao-ganhou');
            texto.textContent = parseFloat(valorPremio).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
        } else {
            fundo.classList.add('nao-ganhou');
            texto.textContent = "Não foi dessa vez!";
        }

        const width = container.clientWidth;
        // Remove canvas velho se houver
        const old = container.querySelector('canvas'); if(old) old.remove();

        // TRUQUE: Adiciona timestamp para evitar cache da imagem quebrada
        const imagePath = 'imagem-raspadinha.png?t=' + new Date().getTime();

        const sc = new ScratchCard('#raspadinha-container', {
            scratchType: ScratchCard.SCRATCH_TYPE.SPRAY,
            containerWidth: width,
            containerHeight: width * 0.5625,
            imageForwardSrc: imagePath, // Usa o caminho com cache-buster
            clearZoneRadius: 40,
            nPoints: 100,
            pointSize: 4,
            callback: () => {
                status.textContent = valorPremio > 0 ? "PARABÉNS!" : "Tente novamente!";
                document.getElementById('btn-jogar-novamente').style.display = 'block';
            }
        });

        sc.init().then(() => {
            console.log("Raspadinha carregada.");
        }).catch((err) => {
            console.error("Erro imagem:", err);
            status.innerHTML = "ERRO: Imagem 'imagem-raspadinha.png' não encontrada.<br>Renomeie o arquivo na pasta public!";
            status.style.color = "red";
        });
    }
});
