#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TRANSLATIONS = {
  en: {
    mcp: {
      pageTitle: 'Diagram with GitHub Copilot',
      pageSubtitle:
        'Give GitHub Copilot App and CLI the tools to turn prompts and code into editable diagrams. Other MCP clients work here, too.',
      visualAlt:
        'GitHub Copilot App and CLI connect to local OpenFlowKit MCP tools to create editable diagrams.',
      visualClients: 'App and CLI',
      visualServer: 'Local diagramming tools',
      visualResult: 'Editable diagrams',
      visualResultHint: 'Validate, preview, share',
      visualCaption:
        'Tools run locally over stdio. Your AI client handles model requests. No OpenFlowKit API key required.',
    },
    mcpSettings: {
      title: 'Connect GitHub Copilot',
      intro:
        'Bring OpenFlowKit diagramming tools to GitHub Copilot App or CLI. Claude Code, Claude Desktop, Cursor, and Windsurf are supported too.',
      clientPicker: 'Choose your client',
      otherClients: 'Other MCP clients',
      appDescription: 'Set up in your desktop workspace',
      cliDescription: 'Set up from your terminal',
      setupTitle: '{{client}} setup',
      installNote:
        'Requires Node.js 18+ where your client runs. No global server install needed; npx downloads it on first use.',
      sharedConfig:
        'One configuration, both clients: MCP servers configured for Copilot CLI are also available in Copilot App.',
      stepsLabel: 'Setup steps',
      configHeading: 'Add the server',
      appSetup:
        'In GitHub Copilot App, open Customize → MCP and add a custom server. Choose a local/stdio server and use these settings.',
      appVerify:
        'Save the server, then open Customize → Installed to manage it. If you edited the JSON file, start a new Copilot session to load the change.',
      cliSetup:
        'With Copilot CLI installed and signed in, run this in your terminal. It registers OpenFlowKit in your user-level MCP configuration.',
      cliVerify:
        'Start a new copilot session, then run /mcp show openflowkit to check its tools. You can also add servers interactively with /mcp add; those are available immediately.',
      claudeCodeSetup:
        'Merge this configuration into .mcp.json at your project root. Keep any existing servers.',
      claudeCodeVerify:
        'Start Claude Code in the project, approve the project MCP server when prompted, and use /mcp to check the connection.',
      claudeSetup:
        'Open Claude Desktop settings, go to Developer → Edit Config, and merge this server into your configuration.',
      claudeVerify:
        'Restart Claude Desktop, then check that openflowkit appears in the available tools.',
      cursorSetup:
        'Merge this server into your Cursor MCP configuration. Keep any existing servers.',
      cursorVerify:
        'Open Cursor settings → Tools & MCP and enable openflowkit. Use Agent mode to access its tools.',
      windsurfSetup:
        'Merge this server into your Windsurf MCP configuration. Keep any existing servers.',
      windsurfVerify:
        'Refresh MCP servers in Windsurf settings, then open Cascade and check that openflowkit is available.',
      copyInstall: 'Copy setup command',
      serverName: 'Server name',
      transport: 'Transport',
      environment: 'Environment',
      manualConfig: 'JSON configuration and setup prompt',
      mergeNote:
        'Merge the openflowkit entry into mcpServers. Preserve your other servers and settings.',
      copyConfig: 'Copy MCP config',
      installPromptHint: 'Or ask your coding assistant to merge the configuration for you:',
      installPrompt:
        'Add an MCP server named "openflowkit" to {{path}} for {{client}}. Merge the entry below into the existing mcpServers object, preserving all other servers and settings. Create the file if it does not exist. Explain how to reload the client after saving.\n\n{{config}}',
      copyInstallPrompt: 'Copy setup prompt',
      verifyHeading: 'Check the connection',
      connectionPrompt:
        'Call server_info from the openflowkit MCP server and report its version and available tools.',
      copyConnectionPrompt: 'Copy connection test prompt',
      tryItHeading: 'Create your first diagram',
      tryItIntro:
        'Paste this into your connected client. It will author the diagram, validate it, and return an OpenFlowKit viewer link.',
      diagramPrompt:
        'Use the openflowkit MCP tools to create a checkout flow with cart, shipping, a promo-code decision, payment, and confirmation. Start with list_starter_templates and get_starter_template to learn the DSL. Call validate_openflow_dsl, fix any errors, then call create_viewer_url. Return the final DSL and viewer link.',
      copyTestPrompt: 'Copy diagram prompt',
      toolsHeading: 'Explore the 8 diagramming tools',
      author: 'Author',
      inspect: 'Inspect',
      discover: 'Discover',
      toolValidate: 'Validate agent-authored DSL',
      toolViewer: 'Create an editable diagram link',
      toolAnalyze: 'Inspect a local codebase',
      toolIcons: 'Find cloud and developer icons',
      toolTemplates: 'Browse starter templates',
      toolTemplate: 'Read a template and its DSL',
      toolNodes: 'Explore node types and shapes',
      toolInfo: 'Check version and capabilities',
      docsLink: 'Full MCP documentation',
      copilotDocs: 'GitHub Copilot setup guide',
      copy: 'Copy',
      copied: 'Copied',
      copyError: 'Clipboard access failed. Select and copy the text above manually.',
    },
  },
  de: {
    mcp: {
      pageTitle: 'Diagramme mit GitHub Copilot',
      pageSubtitle:
        'Mit GitHub Copilot App und CLI werden Prompts und Code zu bearbeitbaren Diagrammen. Andere MCP-Clients werden ebenfalls unterstützt.',
      visualAlt:
        'GitHub Copilot App und CLI nutzen lokale OpenFlowKit-MCP-Tools, um bearbeitbare Diagramme zu erstellen.',
      visualClients: 'App und CLI',
      visualServer: 'Lokale Diagramm-Tools',
      visualResult: 'Bearbeitbare Diagramme',
      visualResultHint: 'Validieren, ansehen, teilen',
      visualCaption:
        'Die Tools laufen lokal über stdio. Dein KI-Client übernimmt Modellanfragen. Kein OpenFlowKit-API-Schlüssel erforderlich.',
    },
    mcpSettings: {
      title: 'GitHub Copilot verbinden',
      intro:
        'Nutze die Diagramm-Tools von OpenFlowKit in GitHub Copilot App oder CLI. Claude Code, Claude Desktop, Cursor und Windsurf werden ebenfalls unterstützt.',
      clientPicker: 'Client auswählen',
      otherClients: 'Andere MCP-Clients',
      appDescription: 'Im Desktop-Arbeitsbereich einrichten',
      cliDescription: 'Im Terminal einrichten',
      setupTitle: '{{client}} einrichten',
      installNote:
        'Erfordert Node.js 18+ auf dem Rechner deines Clients. Keine globale Serverinstallation nötig; npx lädt ihn beim ersten Einsatz.',
      sharedConfig:
        'Eine Konfiguration für beide Clients: In Copilot CLI konfigurierte MCP-Server sind auch in Copilot App verfügbar.',
      stepsLabel: 'Einrichtungsschritte',
      configHeading: 'Server hinzufügen',
      appSetup:
        'Öffne in GitHub Copilot App Customize → MCP und füge einen eigenen Server hinzu. Wähle einen lokalen/stdio-Server mit diesen Einstellungen.',
      appVerify:
        'Speichere den Server und verwalte ihn unter Customize → Installed. Nach einer Änderung der JSON-Datei startest du eine neue Copilot-Sitzung.',
      cliSetup:
        'Installiere Copilot CLI, melde dich an und führe diesen Befehl im Terminal aus. Er registriert OpenFlowKit in deiner benutzerweiten MCP-Konfiguration.',
      cliVerify:
        'Starte eine neue copilot-Sitzung und prüfe die Tools mit /mcp show openflowkit. Mit /mcp add interaktiv hinzugefügte Server sind sofort verfügbar.',
      claudeCodeSetup:
        'Füge diese Konfiguration in .mcp.json im Projektstamm ein. Behalte vorhandene Server bei.',
      claudeCodeVerify:
        'Starte Claude Code im Projekt, bestätige den Projekt-MCP-Server bei Aufforderung und prüfe die Verbindung mit /mcp.',
      claudeSetup:
        'Öffne die Einstellungen von Claude Desktop, gehe zu Developer → Edit Config und füge diesen Server zur Konfiguration hinzu.',
      claudeVerify:
        'Starte Claude Desktop neu und prüfe, ob openflowkit in den verfügbaren Tools erscheint.',
      cursorSetup:
        'Füge diesen Server zur MCP-Konfiguration von Cursor hinzu. Behalte vorhandene Server bei.',
      cursorVerify:
        'Öffne die Cursor-Einstellungen → Tools & MCP und aktiviere openflowkit. Nutze den Agent-Modus für seine Tools.',
      windsurfSetup:
        'Füge diesen Server zur MCP-Konfiguration von Windsurf hinzu. Behalte vorhandene Server bei.',
      windsurfVerify:
        'Aktualisiere die MCP-Server in den Windsurf-Einstellungen. Öffne Cascade und prüfe, ob openflowkit verfügbar ist.',
      copyInstall: 'Einrichtungsbefehl kopieren',
      serverName: 'Servername',
      transport: 'Transport',
      environment: 'Umgebung',
      manualConfig: 'JSON-Konfiguration und Einrichtungs-Prompt',
      mergeNote:
        'Füge den openflowkit-Eintrag in mcpServers ein. Behalte andere Server und Einstellungen bei.',
      copyConfig: 'MCP-Konfiguration kopieren',
      installPromptHint:
        'Oder bitte deinen Coding-Assistenten, die Konfiguration für dich zusammenzuführen:',
      installPrompt:
        'Füge einen MCP-Server namens "openflowkit" für {{client}} in {{path}} hinzu. Füge den folgenden Eintrag in das bestehende mcpServers-Objekt ein und behalte alle anderen Server und Einstellungen bei. Erstelle die Datei, falls sie nicht existiert. Erkläre, wie ich den Client nach dem Speichern neu lade.\n\n{{config}}',
      copyInstallPrompt: 'Einrichtungs-Prompt kopieren',
      verifyHeading: 'Verbindung prüfen',
      connectionPrompt:
        'Rufe server_info vom openflowkit-MCP-Server auf und nenne seine Version und verfügbaren Tools.',
      copyConnectionPrompt: 'Verbindungstest-Prompt kopieren',
      tryItHeading: 'Erstes Diagramm erstellen',
      tryItIntro:
        'Füge dies in deinen verbundenen Client ein. Er erstellt und validiert das Diagramm und liefert einen OpenFlowKit-Viewer-Link.',
      diagramPrompt:
        'Erstelle mit den openflowkit-MCP-Tools einen Checkout-Ablauf mit Warenkorb, Versand, Gutscheincode-Entscheidung, Zahlung und Bestätigung. Beginne mit list_starter_templates und get_starter_template, um die DSL kennenzulernen. Rufe validate_openflow_dsl auf, behebe Fehler und rufe dann create_viewer_url auf. Gib die fertige DSL und den Viewer-Link zurück.',
      copyTestPrompt: 'Diagramm-Prompt kopieren',
      toolsHeading: 'Die 8 Diagramm-Tools entdecken',
      author: 'Erstellen',
      inspect: 'Untersuchen',
      discover: 'Entdecken',
      toolValidate: 'Vom Agenten erstellte DSL validieren',
      toolViewer: 'Link zu einem bearbeitbaren Diagramm erstellen',
      toolAnalyze: 'Lokale Codebasis untersuchen',
      toolIcons: 'Cloud- und Entwickler-Icons finden',
      toolTemplates: 'Startvorlagen durchsuchen',
      toolTemplate: 'Vorlage und ihre DSL lesen',
      toolNodes: 'Knotentypen und Formen erkunden',
      toolInfo: 'Version und Funktionen prüfen',
      docsLink: 'Vollständige MCP-Dokumentation',
      copilotDocs: 'GitHub-Copilot-Einrichtungsanleitung',
      copy: 'Kopieren',
      copied: 'Kopiert',
      copyError:
        'Zugriff auf die Zwischenablage fehlgeschlagen. Markiere und kopiere den Text oben manuell.',
    },
  },
  es: {
    mcp: {
      pageTitle: 'Crea diagramas con GitHub Copilot',
      pageSubtitle:
        'Dale a GitHub Copilot App y CLI herramientas para convertir instrucciones y código en diagramas editables. También puedes usar otros clientes MCP.',
      visualAlt:
        'GitHub Copilot App y CLI se conectan a las herramientas MCP locales de OpenFlowKit para crear diagramas editables.',
      visualClients: 'App y CLI',
      visualServer: 'Herramientas locales de diagramación',
      visualResult: 'Diagramas editables',
      visualResultHint: 'Valida, visualiza, comparte',
      visualCaption:
        'Las herramientas se ejecutan localmente por stdio. Tu cliente de IA gestiona las solicitudes al modelo. No necesitas una clave de API de OpenFlowKit.',
    },
    mcpSettings: {
      title: 'Conecta GitHub Copilot',
      intro:
        'Usa las herramientas de diagramación de OpenFlowKit en GitHub Copilot App o CLI. También se admiten Claude Code, Claude Desktop, Cursor y Windsurf.',
      clientPicker: 'Elige tu cliente',
      otherClients: 'Otros clientes MCP',
      appDescription: 'Configura en tu espacio de escritorio',
      cliDescription: 'Configura desde tu terminal',
      setupTitle: 'Configuración de {{client}}',
      installNote:
        'Requiere Node.js 18+ donde se ejecute tu cliente. No hace falta instalar el servidor globalmente; npx lo descarga al usarlo por primera vez.',
      sharedConfig:
        'Una configuración para ambos clientes: los servidores MCP configurados en Copilot CLI también están disponibles en Copilot App.',
      stepsLabel: 'Pasos de configuración',
      configHeading: 'Añade el servidor',
      appSetup:
        'En GitHub Copilot App, abre Customize → MCP y añade un servidor personalizado. Elige un servidor local/stdio y usa estos ajustes.',
      appVerify:
        'Guarda el servidor y abre Customize → Installed para gestionarlo. Si editaste el archivo JSON, inicia una nueva sesión de Copilot para cargar el cambio.',
      cliSetup:
        'Con Copilot CLI instalado y la sesión iniciada, ejecuta esto en tu terminal. Registra OpenFlowKit en tu configuración MCP de usuario.',
      cliVerify:
        'Inicia una nueva sesión de copilot y ejecuta /mcp show openflowkit para comprobar sus herramientas. También puedes añadir servidores con /mcp add; estarán disponibles de inmediato.',
      claudeCodeSetup:
        'Combina esta configuración con .mcp.json en la raíz de tu proyecto. Conserva los servidores existentes.',
      claudeCodeVerify:
        'Inicia Claude Code en el proyecto, aprueba el servidor MCP del proyecto cuando se solicite y usa /mcp para comprobar la conexión.',
      claudeSetup:
        'Abre los ajustes de Claude Desktop, ve a Developer → Edit Config y añade este servidor a tu configuración.',
      claudeVerify:
        'Reinicia Claude Desktop y comprueba que openflowkit aparece entre las herramientas disponibles.',
      cursorSetup:
        'Añade este servidor a la configuración MCP de Cursor. Conserva los servidores existentes.',
      cursorVerify:
        'Abre los ajustes de Cursor → Tools & MCP y activa openflowkit. Usa el modo Agent para acceder a sus herramientas.',
      windsurfSetup:
        'Añade este servidor a la configuración MCP de Windsurf. Conserva los servidores existentes.',
      windsurfVerify:
        'Actualiza los servidores MCP en los ajustes de Windsurf. Abre Cascade y comprueba que openflowkit está disponible.',
      copyInstall: 'Copiar comando de configuración',
      serverName: 'Nombre del servidor',
      transport: 'Transporte',
      environment: 'Entorno',
      manualConfig: 'Configuración JSON y prompt de configuración',
      mergeNote:
        'Añade la entrada openflowkit a mcpServers. Conserva los demás servidores y ajustes.',
      copyConfig: 'Copiar configuración MCP',
      installPromptHint:
        'O pide a tu asistente de programación que combine la configuración por ti:',
      installPrompt:
        'Añade un servidor MCP llamado "openflowkit" a {{path}} para {{client}}. Combina la entrada siguiente con el objeto mcpServers existente y conserva los demás servidores y ajustes. Crea el archivo si no existe. Explica cómo recargar el cliente después de guardar.\n\n{{config}}',
      copyInstallPrompt: 'Copiar prompt de configuración',
      verifyHeading: 'Comprueba la conexión',
      connectionPrompt:
        'Llama a server_info del servidor MCP openflowkit e indica su versión y herramientas disponibles.',
      copyConnectionPrompt: 'Copiar prompt de prueba de conexión',
      tryItHeading: 'Crea tu primer diagrama',
      tryItIntro:
        'Pega esto en tu cliente conectado. Creará el diagrama, lo validará y devolverá un enlace al visor de OpenFlowKit.',
      diagramPrompt:
        'Usa las herramientas MCP de openflowkit para crear un flujo de compra con carrito, envío, decisión de código promocional, pago y confirmación. Empieza con list_starter_templates y get_starter_template para aprender la DSL. Llama a validate_openflow_dsl, corrige los errores y llama a create_viewer_url. Devuelve la DSL final y el enlace al visor.',
      copyTestPrompt: 'Copiar prompt de diagrama',
      toolsHeading: 'Explora las 8 herramientas de diagramación',
      author: 'Crear',
      inspect: 'Inspeccionar',
      discover: 'Descubrir',
      toolValidate: 'Validar la DSL escrita por el agente',
      toolViewer: 'Crear un enlace a un diagrama editable',
      toolAnalyze: 'Inspeccionar una base de código local',
      toolIcons: 'Buscar iconos de nube y desarrollo',
      toolTemplates: 'Explorar plantillas iniciales',
      toolTemplate: 'Leer una plantilla y su DSL',
      toolNodes: 'Explorar tipos de nodo y formas',
      toolInfo: 'Comprobar la versión y capacidades',
      docsLink: 'Documentación completa de MCP',
      copilotDocs: 'Guía de configuración de GitHub Copilot',
      copy: 'Copiar',
      copied: 'Copiado',
      copyError:
        'No se pudo acceder al portapapeles. Selecciona y copia manualmente el texto de arriba.',
    },
  },
  fr: {
    mcp: {
      pageTitle: 'Créez des diagrammes avec GitHub Copilot',
      pageSubtitle:
        'Donnez à GitHub Copilot App et CLI les outils pour transformer vos prompts et votre code en diagrammes modifiables. Les autres clients MCP sont aussi compatibles.',
      visualAlt:
        'GitHub Copilot App et CLI utilisent les outils MCP locaux d’OpenFlowKit pour créer des diagrammes modifiables.',
      visualClients: 'App et CLI',
      visualServer: 'Outils de diagramme locaux',
      visualResult: 'Diagrammes modifiables',
      visualResultHint: 'Valider, visualiser, partager',
      visualCaption:
        'Les outils tournent localement via stdio. Votre client IA gère les requêtes au modèle. Aucune clé d’API OpenFlowKit requise.',
    },
    mcpSettings: {
      title: 'Connecter GitHub Copilot',
      intro:
        'Utilisez les outils de diagramme d’OpenFlowKit dans GitHub Copilot App ou CLI. Claude Code, Claude Desktop, Cursor et Windsurf sont aussi compatibles.',
      clientPicker: 'Choisissez votre client',
      otherClients: 'Autres clients MCP',
      appDescription: 'Configurer dans votre espace de bureau',
      cliDescription: 'Configurer depuis votre terminal',
      setupTitle: 'Configuration de {{client}}',
      installNote:
        'Nécessite Node.js 18+ là où votre client s’exécute. Aucune installation globale du serveur ; npx le télécharge à la première utilisation.',
      sharedConfig:
        'Une configuration pour les deux clients : les serveurs MCP configurés pour Copilot CLI sont aussi disponibles dans Copilot App.',
      stepsLabel: 'Étapes de configuration',
      configHeading: 'Ajouter le serveur',
      appSetup:
        'Dans GitHub Copilot App, ouvrez Customize → MCP et ajoutez un serveur personnalisé. Choisissez un serveur local/stdio avec ces paramètres.',
      appVerify:
        'Enregistrez le serveur, puis ouvrez Customize → Installed pour le gérer. Si vous avez modifié le fichier JSON, démarrez une nouvelle session Copilot.',
      cliSetup:
        'Avec Copilot CLI installé et connecté, exécutez ceci dans votre terminal. La commande enregistre OpenFlowKit dans votre configuration MCP utilisateur.',
      cliVerify:
        'Démarrez une nouvelle session copilot, puis lancez /mcp show openflowkit pour vérifier ses outils. Les serveurs ajoutés via /mcp add sont disponibles immédiatement.',
      claudeCodeSetup:
        'Fusionnez cette configuration dans .mcp.json à la racine de votre projet. Conservez les serveurs existants.',
      claudeCodeVerify:
        'Démarrez Claude Code dans le projet, approuvez le serveur MCP du projet à la demande et vérifiez la connexion avec /mcp.',
      claudeSetup:
        'Ouvrez les paramètres de Claude Desktop, allez dans Developer → Edit Config et ajoutez ce serveur à votre configuration.',
      claudeVerify:
        'Redémarrez Claude Desktop et vérifiez que openflowkit figure parmi les outils disponibles.',
      cursorSetup:
        'Ajoutez ce serveur à votre configuration MCP de Cursor. Conservez les serveurs existants.',
      cursorVerify:
        'Ouvrez les paramètres de Cursor → Tools & MCP et activez openflowkit. Utilisez le mode Agent pour accéder à ses outils.',
      windsurfSetup:
        'Ajoutez ce serveur à votre configuration MCP de Windsurf. Conservez les serveurs existants.',
      windsurfVerify:
        'Actualisez les serveurs MCP dans les paramètres de Windsurf. Ouvrez Cascade et vérifiez que openflowkit est disponible.',
      copyInstall: 'Copier la commande de configuration',
      serverName: 'Nom du serveur',
      transport: 'Transport',
      environment: 'Environnement',
      manualConfig: 'Configuration JSON et prompt de configuration',
      mergeNote:
        'Ajoutez l’entrée openflowkit à mcpServers. Conservez les autres serveurs et paramètres.',
      copyConfig: 'Copier la configuration MCP',
      installPromptHint:
        'Ou demandez à votre assistant de programmation de fusionner la configuration :',
      installPrompt:
        'Ajoute un serveur MCP nommé "openflowkit" dans {{path}} pour {{client}}. Fusionne l’entrée ci-dessous dans l’objet mcpServers existant en conservant les autres serveurs et paramètres. Crée le fichier s’il n’existe pas. Explique comment recharger le client après l’enregistrement.\n\n{{config}}',
      copyInstallPrompt: 'Copier le prompt de configuration',
      verifyHeading: 'Vérifier la connexion',
      connectionPrompt:
        'Appelle server_info du serveur MCP openflowkit et indique sa version et ses outils disponibles.',
      copyConnectionPrompt: 'Copier le prompt de test de connexion',
      tryItHeading: 'Créer votre premier diagramme',
      tryItIntro:
        'Collez ceci dans votre client connecté. Il créera et validera le diagramme, puis renverra un lien vers le visualiseur OpenFlowKit.',
      diagramPrompt:
        'Utilise les outils MCP openflowkit pour créer un parcours d’achat avec panier, livraison, décision de code promotionnel, paiement et confirmation. Commence par list_starter_templates et get_starter_template pour apprendre le DSL. Appelle validate_openflow_dsl, corrige les erreurs, puis appelle create_viewer_url. Renvoie le DSL final et le lien du visualiseur.',
      copyTestPrompt: 'Copier le prompt de diagramme',
      toolsHeading: 'Découvrir les 8 outils de diagramme',
      author: 'Créer',
      inspect: 'Inspecter',
      discover: 'Découvrir',
      toolValidate: 'Valider le DSL rédigé par l’agent',
      toolViewer: 'Créer un lien vers un diagramme modifiable',
      toolAnalyze: 'Inspecter une base de code locale',
      toolIcons: 'Trouver des icônes cloud et de développement',
      toolTemplates: 'Parcourir les modèles de départ',
      toolTemplate: 'Lire un modèle et son DSL',
      toolNodes: 'Explorer les types de nœuds et les formes',
      toolInfo: 'Vérifier la version et les capacités',
      docsLink: 'Documentation MCP complète',
      copilotDocs: 'Guide de configuration GitHub Copilot',
      copy: 'Copier',
      copied: 'Copié',
      copyError:
        'Accès au presse-papiers impossible. Sélectionnez et copiez manuellement le texte ci-dessus.',
    },
  },
  ja: {
    mcp: {
      pageTitle: 'GitHub Copilot で図を作成',
      pageSubtitle:
        'GitHub Copilot App と CLI に、プロンプトやコードから編集可能な図を作るツールを追加します。他の MCP クライアントにも対応しています。',
      visualAlt:
        'GitHub Copilot App と CLI がローカルの OpenFlowKit MCP ツールに接続し、編集可能な図を作成します。',
      visualClients: 'App と CLI',
      visualServer: 'ローカルの作図ツール',
      visualResult: '編集可能な図',
      visualResultHint: '検証・プレビュー・共有',
      visualCaption:
        'ツールは stdio 経由でローカル実行されます。モデルへのリクエストは AI クライアントが処理します。OpenFlowKit の API キーは不要です。',
    },
    mcpSettings: {
      title: 'GitHub Copilot を接続',
      intro:
        'OpenFlowKit の作図ツールを GitHub Copilot App または CLI で使えます。Claude Code、Claude Desktop、Cursor、Windsurf にも対応しています。',
      clientPicker: 'クライアントを選択',
      otherClients: 'その他の MCP クライアント',
      appDescription: 'デスクトップのワークスペースで設定',
      cliDescription: 'ターミナルから設定',
      setupTitle: '{{client}} の設定',
      installNote:
        'クライアントの実行環境に Node.js 18+ が必要です。サーバーのグローバルインストールは不要で、初回利用時に npx が取得します。',
      sharedConfig:
        '設定は両クライアントで共通です。Copilot CLI で設定した MCP サーバーは Copilot App でも利用できます。',
      stepsLabel: '設定手順',
      configHeading: 'サーバーを追加',
      appSetup:
        'GitHub Copilot App で Customize → MCP を開き、カスタムサーバーを追加します。ローカル/stdio サーバーを選び、以下の設定を使います。',
      appVerify:
        'サーバーを保存し、Customize → Installed で管理します。JSON ファイルを編集した場合は、新しい Copilot セッションを開始して変更を読み込みます。',
      cliSetup:
        'Copilot CLI をインストールしてサインインしたら、ターミナルでこのコマンドを実行します。ユーザーの MCP 設定に OpenFlowKit を登録します。',
      cliVerify:
        '新しい copilot セッションを開始し、/mcp show openflowkit でツールを確認します。/mcp add で対話的に追加したサーバーはすぐに利用できます。',
      claudeCodeSetup:
        'プロジェクトのルートにある .mcp.json にこの設定を統合します。既存のサーバーは保持してください。',
      claudeCodeVerify:
        'プロジェクトで Claude Code を起動し、確認画面でプロジェクトの MCP サーバーを承認してから /mcp で接続を確認します。',
      claudeSetup:
        'Claude Desktop の設定から Developer → Edit Config を開き、このサーバーを設定に追加します。',
      claudeVerify:
        'Claude Desktop を再起動し、利用可能なツールに openflowkit が表示されることを確認します。',
      cursorSetup:
        'Cursor の MCP 設定にこのサーバーを追加します。既存のサーバーは保持してください。',
      cursorVerify:
        'Cursor の設定 → Tools & MCP で openflowkit を有効にします。ツールを使うには Agent モードを選択します。',
      windsurfSetup:
        'Windsurf の MCP 設定にこのサーバーを追加します。既存のサーバーは保持してください。',
      windsurfVerify:
        'Windsurf の設定で MCP サーバーを更新し、Cascade を開いて openflowkit が利用可能か確認します。',
      copyInstall: '設定コマンドをコピー',
      serverName: 'サーバー名',
      transport: 'トランスポート',
      environment: '環境変数',
      manualConfig: 'JSON 設定と設定用プロンプト',
      mergeNote:
        'openflowkit の項目を mcpServers に統合します。他のサーバーや設定は保持してください。',
      copyConfig: 'MCP 設定をコピー',
      installPromptHint: 'または、コーディングアシスタントに設定の統合を依頼できます：',
      installPrompt:
        '{{client}} 用に、{{path}} に "openflowkit" という MCP サーバーを追加してください。以下の項目を既存の mcpServers オブジェクトに統合し、他のサーバーや設定は保持してください。ファイルがなければ作成してください。保存後にクライアントを再読み込みする方法も説明してください。\n\n{{config}}',
      copyInstallPrompt: '設定用プロンプトをコピー',
      verifyHeading: '接続を確認',
      connectionPrompt:
        'openflowkit MCP サーバーの server_info を呼び出し、バージョンと利用可能なツールを報告してください。',
      copyConnectionPrompt: '接続テスト用プロンプトをコピー',
      tryItHeading: '最初の図を作成',
      tryItIntro:
        '接続済みのクライアントに貼り付けてください。図を作成・検証し、OpenFlowKit のビューアリンクを返します。',
      diagramPrompt:
        'openflowkit MCP ツールで、カート、配送、クーポンコードの分岐、支払い、確認を含む購入フローを作成してください。list_starter_templates と get_starter_template で DSL を確認してから、validate_openflow_dsl を呼び出し、エラーを修正して create_viewer_url を呼び出してください。最終的な DSL とビューアリンクを返してください。',
      copyTestPrompt: '作図用プロンプトをコピー',
      toolsHeading: '8 つの作図ツールを見る',
      author: '作成',
      inspect: '調査',
      discover: '探索',
      toolValidate: 'エージェントが作成した DSL を検証',
      toolViewer: '編集可能な図のリンクを作成',
      toolAnalyze: 'ローカルのコードベースを調査',
      toolIcons: 'クラウド・開発者アイコンを検索',
      toolTemplates: 'スターターテンプレートを閲覧',
      toolTemplate: 'テンプレートと DSL を取得',
      toolNodes: 'ノードの種類と形状を確認',
      toolInfo: 'バージョンと機能を確認',
      docsLink: 'MCP の詳細ドキュメント',
      copilotDocs: 'GitHub Copilot 設定ガイド',
      copy: 'コピー',
      copied: 'コピー済み',
      copyError:
        'クリップボードにアクセスできませんでした。上のテキストを選択して手動でコピーしてください。',
    },
  },
  tr: {
    mcp: {
      pageTitle: 'GitHub Copilot ile diyagram oluştur',
      pageSubtitle:
        'GitHub Copilot App ve CLI ile istemleri ve kodu düzenlenebilir diyagramlara dönüştür. Diğer MCP istemcileri de desteklenir.',
      visualAlt:
        'GitHub Copilot App ve CLI, düzenlenebilir diyagramlar oluşturmak için yerel OpenFlowKit MCP araçlarına bağlanır.',
      visualClients: 'App ve CLI',
      visualServer: 'Yerel diyagram araçları',
      visualResult: 'Düzenlenebilir diyagramlar',
      visualResultHint: 'Doğrula, önizle, paylaş',
      visualCaption:
        'Araçlar stdio üzerinden yerel çalışır. Model isteklerini AI istemcin yönetir. OpenFlowKit API anahtarı gerekmez.',
    },
    mcpSettings: {
      title: 'GitHub Copilot’u bağla',
      intro:
        'OpenFlowKit diyagram araçlarını GitHub Copilot App veya CLI ile kullan. Claude Code, Claude Desktop, Cursor ve Windsurf de desteklenir.',
      clientPicker: 'İstemcini seç',
      otherClients: 'Diğer MCP istemcileri',
      appDescription: 'Masaüstü çalışma alanında kur',
      cliDescription: 'Terminalinden kur',
      setupTitle: '{{client}} kurulumu',
      installNote:
        'İstemcinin çalıştığı ortamda Node.js 18+ gerekir. Sunucuyu global kurmana gerek yok; npx ilk kullanımda indirir.',
      sharedConfig:
        'İki istemci için tek yapılandırma: Copilot CLI için yapılandırılan MCP sunucuları Copilot App içinde de kullanılabilir.',
      stepsLabel: 'Kurulum adımları',
      configHeading: 'Sunucuyu ekle',
      appSetup:
        'GitHub Copilot App içinde Customize → MCP bölümünü aç ve özel bir sunucu ekle. Yerel/stdio sunucusu seçip bu ayarları kullan.',
      appVerify:
        'Sunucuyu kaydet, ardından yönetmek için Customize → Installed bölümünü aç. JSON dosyasını düzenlediysen değişikliği yüklemek için yeni bir Copilot oturumu başlat.',
      cliSetup:
        'Copilot CLI kurulu ve oturumun açıkken bunu terminalinde çalıştır. OpenFlowKit’i kullanıcı düzeyindeki MCP yapılandırmana kaydeder.',
      cliVerify:
        'Yeni bir copilot oturumu başlat, ardından araçları kontrol etmek için /mcp show openflowkit çalıştır. /mcp add ile etkileşimli eklediğin sunucular hemen kullanılabilir.',
      claudeCodeSetup:
        'Bu yapılandırmayı proje kökündeki .mcp.json dosyasına birleştir. Mevcut sunucuları koru.',
      claudeCodeVerify:
        'Projede Claude Code’u başlat, istendiğinde projenin MCP sunucusunu onayla ve /mcp ile bağlantıyı kontrol et.',
      claudeSetup:
        'Claude Desktop ayarlarında Developer → Edit Config bölümünü aç ve bu sunucuyu yapılandırmana ekle.',
      claudeVerify:
        'Claude Desktop’ı yeniden başlat ve kullanılabilir araçlarda openflowkit göründüğünü kontrol et.',
      cursorSetup: 'Bu sunucuyu Cursor MCP yapılandırmana ekle. Mevcut sunucuları koru.',
      cursorVerify:
        'Cursor ayarlarında Tools & MCP bölümünü aç ve openflowkit’i etkinleştir. Araçlarına erişmek için Agent modunu kullan.',
      windsurfSetup: 'Bu sunucuyu Windsurf MCP yapılandırmana ekle. Mevcut sunucuları koru.',
      windsurfVerify:
        'Windsurf ayarlarında MCP sunucularını yenile, ardından Cascade’i açıp openflowkit’in kullanılabildiğini kontrol et.',
      copyInstall: 'Kurulum komutunu kopyala',
      serverName: 'Sunucu adı',
      transport: 'Taşıma',
      environment: 'Ortam',
      manualConfig: 'JSON yapılandırması ve kurulum istemi',
      mergeNote:
        'openflowkit kaydını mcpServers içine birleştir. Diğer sunucuları ve ayarları koru.',
      copyConfig: 'MCP yapılandırmasını kopyala',
      installPromptHint:
        'Ya da kodlama asistanından yapılandırmayı senin için birleştirmesini iste:',
      installPrompt:
        '{{client}} için {{path}} dosyasına "openflowkit" adlı bir MCP sunucusu ekle. Aşağıdaki kaydı mevcut mcpServers nesnesine birleştir; diğer sunucuları ve ayarları koru. Dosya yoksa oluştur. Kaydettikten sonra istemciyi nasıl yeniden yükleyeceğimi açıkla.\n\n{{config}}',
      copyInstallPrompt: 'Kurulum istemini kopyala',
      verifyHeading: 'Bağlantıyı kontrol et',
      connectionPrompt:
        'openflowkit MCP sunucusundan server_info çağır; sürümünü ve kullanılabilir araçlarını bildir.',
      copyConnectionPrompt: 'Bağlantı testi istemini kopyala',
      tryItHeading: 'İlk diyagramını oluştur',
      tryItIntro:
        'Bunu bağlı istemcine yapıştır. Diyagramı oluşturup doğrulayacak ve bir OpenFlowKit görüntüleyici bağlantısı döndürecek.',
      diagramPrompt:
        'openflowkit MCP araçlarıyla sepet, kargo, promosyon kodu kararı, ödeme ve onay içeren bir satın alma akışı oluştur. DSL’i öğrenmek için list_starter_templates ve get_starter_template ile başla. validate_openflow_dsl çağır, hataları düzelt, ardından create_viewer_url çağır. Son DSL’i ve görüntüleyici bağlantısını döndür.',
      copyTestPrompt: 'Diyagram istemini kopyala',
      toolsHeading: '8 diyagram aracını keşfet',
      author: 'Oluştur',
      inspect: 'İncele',
      discover: 'Keşfet',
      toolValidate: 'Ajanın yazdığı DSL’i doğrula',
      toolViewer: 'Düzenlenebilir diyagram bağlantısı oluştur',
      toolAnalyze: 'Yerel kod tabanını incele',
      toolIcons: 'Bulut ve geliştirici simgelerini bul',
      toolTemplates: 'Başlangıç şablonlarına göz at',
      toolTemplate: 'Bir şablonu ve DSL’ini oku',
      toolNodes: 'Düğüm türlerini ve şekilleri keşfet',
      toolInfo: 'Sürümü ve yetenekleri kontrol et',
      docsLink: 'Tam MCP belgeleri',
      copilotDocs: 'GitHub Copilot kurulum kılavuzu',
      copy: 'Kopyala',
      copied: 'Kopyalandı',
      copyError: 'Panoya erişilemedi. Yukarıdaki metni seçip elle kopyala.',
    },
  },
  zh: {
    mcp: {
      pageTitle: '使用 GitHub Copilot 绘图',
      pageSubtitle:
        '为 GitHub Copilot App 和 CLI 添加工具，将提示和代码转换为可编辑的图表。也支持其他 MCP 客户端。',
      visualAlt: 'GitHub Copilot App 和 CLI 连接到本地 OpenFlowKit MCP 工具，创建可编辑的图表。',
      visualClients: 'App 和 CLI',
      visualServer: '本地绘图工具',
      visualResult: '可编辑的图表',
      visualResultHint: '验证、预览、分享',
      visualCaption:
        '工具通过 stdio 在本地运行。AI 客户端负责模型请求。无需 OpenFlowKit API 密钥。',
    },
    mcpSettings: {
      title: '连接 GitHub Copilot',
      intro:
        '在 GitHub Copilot App 或 CLI 中使用 OpenFlowKit 绘图工具。也支持 Claude Code、Claude Desktop、Cursor 和 Windsurf。',
      clientPicker: '选择客户端',
      otherClients: '其他 MCP 客户端',
      appDescription: '在桌面工作区中配置',
      cliDescription: '从终端配置',
      setupTitle: '{{client}} 配置',
      installNote: '客户端运行环境需要 Node.js 18+。无需全局安装服务器；npx 会在首次使用时下载。',
      sharedConfig:
        '一次配置，两个客户端通用：为 Copilot CLI 配置的 MCP 服务器也可在 Copilot App 中使用。',
      stepsLabel: '配置步骤',
      configHeading: '添加服务器',
      appSetup:
        '在 GitHub Copilot App 中打开 Customize → MCP，添加自定义服务器。选择本地/stdio 服务器并使用以下设置。',
      appVerify:
        '保存服务器后，打开 Customize → Installed 进行管理。如果编辑了 JSON 文件，请启动新的 Copilot 会话以加载更改。',
      cliSetup:
        '安装并登录 Copilot CLI 后，在终端运行此命令。它会将 OpenFlowKit 注册到用户级 MCP 配置中。',
      cliVerify:
        '启动新的 copilot 会话，然后运行 /mcp show openflowkit 检查工具。也可通过 /mcp add 交互式添加服务器，添加后立即可用。',
      claudeCodeSetup: '将此配置合并到项目根目录的 .mcp.json 中。保留已有服务器。',
      claudeCodeVerify:
        '在项目中启动 Claude Code，按提示批准项目 MCP 服务器，然后使用 /mcp 检查连接。',
      claudeSetup:
        '打开 Claude Desktop 设置，进入 Developer → Edit Config，将此服务器合并到配置中。',
      claudeVerify: '重启 Claude Desktop，确认可用工具中出现 openflowkit。',
      cursorSetup: '将此服务器合并到 Cursor MCP 配置中。保留已有服务器。',
      cursorVerify: '打开 Cursor 设置 → Tools & MCP，启用 openflowkit。使用 Agent 模式访问其工具。',
      windsurfSetup: '将此服务器合并到 Windsurf MCP 配置中。保留已有服务器。',
      windsurfVerify:
        '在 Windsurf 设置中刷新 MCP 服务器，然后打开 Cascade，确认 openflowkit 可用。',
      copyInstall: '复制配置命令',
      serverName: '服务器名称',
      transport: '传输方式',
      environment: '环境变量',
      manualConfig: 'JSON 配置和配置提示',
      mergeNote: '将 openflowkit 条目合并到 mcpServers 中。保留其他服务器和设置。',
      copyConfig: '复制 MCP 配置',
      installPromptHint: '也可以让编程助手帮你合并配置：',
      installPrompt:
        '为 {{client}} 在 {{path}} 中添加名为 "openflowkit" 的 MCP 服务器。将以下条目合并到已有的 mcpServers 对象中，保留其他服务器和设置。如果文件不存在则创建。保存后说明如何重新加载客户端。\n\n{{config}}',
      copyInstallPrompt: '复制配置提示',
      verifyHeading: '检查连接',
      connectionPrompt: '调用 openflowkit MCP 服务器的 server_info，报告其版本和可用工具。',
      copyConnectionPrompt: '复制连接测试提示',
      tryItHeading: '创建第一个图表',
      tryItIntro: '粘贴到已连接的客户端中。它会创建并验证图表，然后返回 OpenFlowKit 查看链接。',
      diagramPrompt:
        '使用 openflowkit MCP 工具创建一个包含购物车、配送、优惠码判断、付款和确认的结账流程。先用 list_starter_templates 和 get_starter_template 学习 DSL。调用 validate_openflow_dsl，修复错误，再调用 create_viewer_url。返回最终 DSL 和查看链接。',
      copyTestPrompt: '复制绘图提示',
      toolsHeading: '探索 8 个绘图工具',
      author: '创作',
      inspect: '检查',
      discover: '发现',
      toolValidate: '验证智能体编写的 DSL',
      toolViewer: '创建可编辑图表的链接',
      toolAnalyze: '检查本地代码库',
      toolIcons: '查找云服务和开发者图标',
      toolTemplates: '浏览入门模板',
      toolTemplate: '读取模板及其 DSL',
      toolNodes: '探索节点类型和形状',
      toolInfo: '检查版本和功能',
      docsLink: '完整 MCP 文档',
      copilotDocs: 'GitHub Copilot 配置指南',
      copy: '复制',
      copied: '已复制',
      copyError: '无法访问剪贴板。请选中上方文本并手动复制。',
    },
  },
};

const ROOTS = [resolve('src/i18n/locales'), resolve('public/locales')];

for (const [locale, translations] of Object.entries(TRANSLATIONS)) {
  for (const root of ROOTS) {
    const path = resolve(root, locale, 'translation.json');
    const json = JSON.parse(await readFile(path, 'utf8'));
    json.settings = { ...(json.settings ?? {}), mcp: 'MCP' };
    json.mcpSettings = translations.mcpSettings;
    json.mcp = translations.mcp;
    await writeFile(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  }
  console.log('updated:', locale);
}
