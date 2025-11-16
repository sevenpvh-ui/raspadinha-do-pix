document.addEventListener('DOMContentLoaded', () => {
    console.log("Admin JS (Raspadinha) carregado.");

    // --- Seletores de Resumo ---
    const totalFaturamentoEl = document.getElementById('total-faturamento');
    const totalPagosEl = document.getElementById('total-premios-pagos');
    const totalPendentesEl = document.getElementById('total-premios-pendentes');

    // --- Seletores de Config ---
    const formConfig = document.getElementById('form-config');
    const precoInput = document.getElementById('preco-raspadinha');
    const premioMaxInput = document.getElementById('premio-maximo-display');
    const configStatus = document.getElementById('config-status');
    
    // --- Seletores de Faixas de Prêmio ---
    const formCriarFaixa = document.getElementById('form-criar-faixa');
    const faixaValorInput = document.getElementById('faixa-valor');
    const faixaChanceInput = document.getElementById('faixa-chance');
    const faixaDescricaoInput = document.getElementById('faixa-descricao');
    const faixaStatus = document.getElementById('faixa-status');
    const tabelaFaixasCorpo = document.getElementById('tabela-faixas-corpo');
    const totalChanceEl = document.getElementById('total-chance');

    // --- Seletores de Vendas/Pagamentos ---
    const tabelaVendasCorpo = document.getElementById('tabela-vendas-corpo');

    // ==========================================================
    // FUNÇÕES AUXILIARES
    // ==========================================================

    function formatarBRL(valor) {
        const numero = parseFloat(valor);
        if (isNaN(numero)) return 'R$ 0,00';
        return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function mostrarStatus(elemento, mensagem, sucesso = true) {
        elemento.textContent = mensagem;
        elemento.className = sucesso ? 'status-message status-success' : 'status-message status-error';
        elemento.style.display = 'block';
        setTimeout(() => { elemento.style.display = 'none'; }, 5000);
    }

    // Wrapper de Fetch para checar autenticação (403)
    async function apiFetch(url, options = {}) {
        options.headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers,
        };
        
        try {
            const response = await fetch(url, options);
            
            // Se a sessão expirou, o server.js (checkAdmin) retorna 403
            if (response.status === 403) {
                alert('Sua sessão expirou. Faça login novamente.');
                window.location.href = '/admin/login.html';
                return null;
            }

            const data = await response.json();

            if (!response.ok) {
                // Lança um erro com a mensagem do servidor
                throw new Error(data.message || `Erro ${response.status}`);
            }

            return data; // Retorna os dados JSON em caso de sucesso

        } catch (err) {
            console.error(`Erro na chamada API para ${url}:`, err);
            throw err; // Propaga o erro para ser pego pelo .catch()
        }
    }

    // ==========================================================
    // CARREGAMENTO DE DADOS
    // ==========================================================

    // 1. Carregar Configurações (Preço)
    async function carregarConfig() {
        try {
            // Usamos a rota PÚBLICA /api/raspadinha/config para carregar os dados
            const data = await (await fetch('/api/raspadinha/config')).json();
            if (data.success) {
                precoInput.value = parseFloat(data.preco).toFixed(2);
                premioMaxInput.value = parseFloat(data.premioMaximo).toFixed(2);
            }
        } catch (err) {
            mostrarStatus(configStatus, `Erro ao carregar configs: ${err.message}`, false);
        }
    }

    // 2. Carregar Faixas de Prêmios
    async function carregarFaixas() {
        try {
            const data = await apiFetch('/admin/api/faixas');
            if (!data) return; // Sessão expirou

            tabelaFaixasCorpo.innerHTML = '';
            let chanceAcumulada = 0;

            if (data.faixas.length === 0) {
                tabelaFaixasCorpo.innerHTML = `<tr><td colspan="4" style="text-align: center;">Nenhuma faixa de prêmio criada.</td></tr>`;
            }

            data.faixas.forEach(faixa => {
                chanceAcumulada += parseFloat(faixa.chance);
                const linha = document.createElement('tr');
                linha.innerHTML = `
                    <td class="col-valor">${formatarBRL(faixa.valor)}</td>
                    <td class="col-qtd">${faixa.chance}%</td>
                    <td class="col-nome">${faixa.descricao || '---'}</td>
                    <td class="col-acao">
                        <button class="btn-perigo" data-id="${faixa.id}">Excluir</button>
                    </td>
                `;
                tabelaFaixasCorpo.appendChild(linha);
            });
            
            totalChanceEl.textContent = chanceAcumulada.toFixed(1);
            if (chanceAcumulada > 100) {
                totalChanceEl.style.color = 'red';
                totalChanceEl.textContent += ' (ERRO: > 100%)';
            } else {
                totalChanceEl.style.color = 'inherit';
            }

        } catch (err) {
            tabelaFaixasCorpo.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red;">${err.message}</td></tr>`;
        }
    }

    // 3. Carregar Vendas e Resumo
    async function carregarVendas() {
        try {
            const data = await apiFetch('/admin/api/vendas');
            if (!data) return; // Sessão expirou

            // Preenche o resumo
            totalFaturamentoEl.textContent = formatarBRL(data.totais.faturamento);
            totalPagosEl.textContent = formatarBRL(data.totais.premios_pagos);
            totalPendentesEl.textContent = formatarBRL(data.totais.premios_pendentes);

            // Preenche a tabela
            tabelaVendasCorpo.innerHTML = '';
            if (data.vendas.length === 0) {
                tabelaVendasCorpo.innerHTML = `<tr><td colspan="7" style="text-align: center;">Nenhuma venda registrada.</td></tr>`;
            }

            data.vendas.forEach(venda => {
                const linha = document.createElement('tr');
                const ePremiado = venda.valor_premio > 0;
                const statusClasse = venda.status_pagamento_premio === 'Pendente' ? 'status-pendente' : 'status-pago';
                
                linha.innerHTML = `
                    <td class="col-data">${venda.data_formatada}</td>
                    <td class="col-nome">${venda.nome_jogador}</td>
                    <td class="col-telefone">${venda.telefone || '---'}</td>
                    <td class="col-valor">${formatarBRL(venda.valor_pago)}</td>
                    <td class="col-valor" style="font-weight: bold; color: ${ePremiado ? 'var(--color-raspadinha-gold)' : '#888'};">
                        ${formatarBRL(venda.valor_premio)}
                    </td>
                    <td class="col-status">
                        ${ePremiado ? `<span class="status-pagamento ${statusClasse}">${venda.status_pagamento_premio}</span>` : '---'}
                    </td>
                    <td class="col-acao">
                        ${ePremiado && venda.status_pagamento_premio === 'Pendente'
                            ? `<button class="btn-pagar" data-id="${venda.id}">Marcar Pago</button>`
                            : (ePremiado ? `<button class="btn-pago" disabled>Pago</button>` : '---')
                        }
                    </td>
                `;
                tabelaVendasCorpo.appendChild(linha);
            });

        } catch (err) {
            tabelaVendasCorpo.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">${err.message}</td></tr>`;
        }
    }

    // ==========================================================
    // EVENT LISTENERS (FORMULÁRIOS)
    // ==========================================================

    // Salvar Config (Preço)
    formConfig.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = formConfig.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Salvando...';
        
        try {
            const data = await apiFetch('/admin/api/config', {
                method: 'POST',
                body: JSON.stringify({
                    preco_raspadinha: precoInput.value,
                    premio_maximo_display: premioMaxInput.value
                })
            });
            if (data && data.success) {
                mostrarStatus(configStatus, data.message, true);
            }
        } catch (err) {
            mostrarStatus(configStatus, err.message, false);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Salvar Configurações';
        }
    });

    // Criar Faixa de Prêmio
    formCriarFaixa.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = formCriarFaixa.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Adicionando...';

        try {
            const data = await apiFetch('/admin/api/faixas', {
                method: 'POST',
                body: JSON.stringify({
                    valor: faixaValorInput.value,
                    chance: faixaChanceInput.value,
                    descricao: faixaDescricaoInput.value
                })
            });
            if (data && data.success) {
                mostrarStatus(faixaStatus, "Faixa adicionada com sucesso!", true);
                formCriarFaixa.reset();
                carregarFaixas(); // Recarrega a tabela de faixas
            }
        } catch (err) {
            mostrarStatus(faixaStatus, err.message, false);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Adicionar Faixa';
        }
    });

    // ==========================================================
    // EVENT LISTENERS (TABELAS)
    // ==========================================================

    // Excluir Faixa de Prêmio
    tabelaFaixasCorpo.addEventListener('click', async (e) => {
        if (e.target.classList.contains('btn-perigo')) {
            const id = e.target.dataset.id;
            if (!confirm(`Tem certeza que deseja excluir esta faixa de prêmio?`)) {
                return;
            }
            
            e.target.disabled = true;
            e.target.textContent = '...';

            try {
                const data = await apiFetch(`/admin/api/faixas/${id}`, {
                    method: 'DELETE'
                });
                if (data && data.success) {
                    carregarFaixas(); // Recarrega a tabela
                }
            } catch (err) {
                alert(`Erro ao excluir: ${err.message}`);
                e.target.disabled = false;
                e.target.textContent = 'Excluir';
            }
        }
    });

    // Marcar Prêmio como Pago
    tabelaVendasCorpo.addEventListener('click', async (e) => {
        if (e.target.classList.contains('btn-pagar')) {
            const id = e.target.dataset.id;
            if (!confirm(`Confirmar pagamento para a Venda ID #${id}?`)) {
                return;
            }

            e.target.disabled = true;
            e.target.textContent = '...';
            
            try {
                const data = await apiFetch(`/admin/api/premio/pagar`, {
                    method: 'POST',
                    body: JSON.stringify({ id: id })
                });
                if (data && data.success) {
                    carregarVendas(); // Recarrega tudo (resumo e tabela)
                }
            } catch (err) {
                alert(`Erro ao pagar: ${err.message}`);
                e.target.disabled = false;
                e.target.textContent = 'Marcar Pago';
            }
        }
    });

    // ==========================================================
    // INICIALIZAÇÃO
    // ==========================================================
    function carregarTudo() {
        carregarConfig();
        carregarFaixas();
        carregarVendas();
    }
    
    carregarTudo();
});