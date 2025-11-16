document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const usuarioInput = document.getElementById('usuario');
    const senhaInput = document.getElementById('senha');
    const errorElement = document.getElementById('login-error');

    // Tenta focar no campo de usuário ao carregar
    if (usuarioInput) {
        usuarioInput.focus();
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Impede o envio padrão
            if (errorElement) errorElement.style.display = 'none'; // Esconde erro anterior
            
            const btn = loginForm.querySelector('button');
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Entrando...';
            }

            const usuario = usuarioInput.value.trim();
            const senha = senhaInput.value;

            if (!usuario || !senha) {
                if (errorElement) {
                    errorElement.textContent = "Usuário e senha são obrigatórios.";
                    errorElement.style.display = 'block';
                }
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Entrar';
                }
                return;
            }

            console.log(`Tentando login admin (Raspadinha) com usuário: ${usuario}`);

            try {
                // 1. A ROTA É A MESMA (o server.js da raspadinha define /admin/login)
                const response = await fetch('/admin/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({ usuario, senha }),
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    console.log("Login (Raspadinha) bem-sucedido!");
                    // 2. O REDIRECIONAMENTO É PARA O PAINEL CORRETO
                    window.location.href = '/admin/index.html'; 
                } else {
                    if (errorElement) {
                        errorElement.textContent = result.message || "Usuário ou senha inválidos.";
                        errorElement.style.display = 'block';
                    }
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = 'Entrar';
                    }
                }
            } catch (error) {
                console.error("Erro de rede (Raspadinha Login):", error);
                if (errorElement) {
                    errorElement.textContent = "Erro de conexão com o servidor. Tente novamente.";
                    errorElement.style.display = 'block';
                }
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Entrar';
                }
            }
        });
    }
});