// InkTube front-end config.
// Launchpad déployé sur Ink mainnet le 16/10/2026 (propriétaire 0x53e9de6cC7b5df7f09747c1Dd7286BE51DBE0072).
// Après `forge script script/Deploy.s.sol ...`, coller l'adresse + le bloc de déploiement ici.
window.INKTUBE_CONFIG = {
  LAUNCHPAD_ADDRESS: "0x1eC209751d2D82950EC8C0b81642C13b700273bF",
  DEPLOY_BLOCK: 58668806,

  // InkTubeLaunchpadV2 (Premiere, anti-snipe, market cap tiers, vesting, fee split).
  // Vide = mode v1 uniquement. Une fois `forge script script/DeployV2.s.sol ...` passé, coller
  // l'adresse du launchpad v2 + son bloc : les nouveaux lancements passent par v2, les tokens v1
  // restent affichés et se tradent toujours sur le v1.
  LAUNCHPAD_V2: "",
  DEPLOY_BLOCK_V2: 0,

  CHAIN_ID: 57073,
  CHAIN_NAME: "Ink",
  RPC_URL: "https://rpc-gel.inkonchain.com",
  EXPLORER: "https://explorer.inkonchain.com",

  // Taille des tranches pour eth_getLogs : rpc-gel.inkonchain.com refuse plus de 1000 blocs par requête.
  LOG_CHUNK: 1000,
  POLL_MS: 6000,
  DEFAULT_SLIPPAGE_BPS: 500,
  IPFS_GATEWAY: "https://ipfs.io/ipfs/",

  // Remplissage temporaire : tant qu'il y a moins de TARGET tokens InkTube, l'accueil est
  // complété avec les tokens tendance d'Ink (source GeckoTerminal). Chaque lancement InkTube
  // prend la place d'un token externe. Mettre ENABLED: false pour couper.
  BACKFILL: {
    ENABLED: true,
    TARGET: 12,
    NETWORK: "ink",
    MAX_FDV_USD: 150000000,
    EXCLUDE: [], // tickers à ne jamais afficher, ex. ["SCAM"]
  },
};
