-- Seed de dados base

-- Categoria
INSERT INTO categoria (categoria_id, nome)
VALUES
    (1, 'Serviços Municipais')
ON CONFLICT (categoria_id) DO NOTHING;

-- Chatbot
INSERT INTO chatbot (
    chatbot_id,
    nome,
    idioma,
    descricao,
    cor,
    icon_path,
    mensagem_sem_resposta,
    greeting_video_text,
    mensagem_inicial,
    mensagem_feedback_positiva,
    mensagem_feedback_negativa,
    endereco,
    genero,
    video_enabled,
    ativo,
    publicado
) VALUES (
    1,
    'Assistente Municipal',
    'pt',
    'Apoio em dúvidas gerais sobre serviços municipais',
    '#d4af37',
    '/static/icons/Assistente_Municipal_1.png',
    'Desculpe, não encontrei uma resposta para a sua questão. Tente reformular a pergunta.',
    'Olá, sou o Assistente Municipal. Como posso ajudar?',
    'Bem-vindo. Posso ajudar com informações sobre serviços municipais.',
    'Obrigado pelo seu feedback.',
    'Lamento não ter conseguido responder. Obrigado pelo seu feedback.',
    'assistente-municipal',
    'm',
    true,
    true,
    true
)
ON CONFLICT (chatbot_id) DO NOTHING;

-- Fonte de resposta
INSERT INTO fonte_resposta (id, chatbot_id, fonte)
VALUES
    (1, 1, 'faq')
ON CONFLICT (id) DO NOTHING;

-- FAQs
INSERT INTO faq (
    faq_id,
    chatbot_id,
    categoria_id,
    identificador,
    designacao,
    pergunta,
    serve_text,
    resposta,
    idioma,
    links_documentos,
    video_text,
    recomendado
) VALUES
    (
        1,
        1,
        1,
        'recolha-monstros',
        'Recolha de monstros',
        'Como pedir recolha de monstros?',
        'Munícipes que pretendam pedir recolha de móveis velhos ou resíduos volumosos.',
        'Pode pedir a recolha de monstros junto dos serviços municipais, mediante agendamento prévio.',
        'pt',
        NULL,
        NULL,
        false
    ),
    (
        2,
        1,
        1,
        'recolha-moveis-velhos',
        'Recolha de móveis velhos',
        'Como marcar recolha de móveis velhos?',
        'Munícipes que pretendam agendar a recolha de móveis velhos ou resíduos volumosos.',
        'Pode marcar a recolha de móveis velhos junto dos serviços municipais, mediante agendamento prévio.',
        'pt',
        NULL,
        NULL,
        false
    ),
    (
        3,
        1,
        1,
        'recolha-sofa-velho',
        'Recolha de sofá velho',
        'Como me livro de um sofá velho?',
        'Munícipes que pretendam encaminhar para recolha móveis grandes, como sofás ou outros objetos volumosos.',
        'Para se desfazer de um sofá velho, deve pedir a recolha junto dos serviços municipais, mediante agendamento prévio.',
        'pt',
        NULL,
        NULL,
        false
    )
ON CONFLICT (faq_id) DO NOTHING;