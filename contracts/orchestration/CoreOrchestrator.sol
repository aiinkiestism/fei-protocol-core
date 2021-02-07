pragma solidity ^0.6.0;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../token/IUniswapIncentive.sol";
import "../token/IFei.sol";
import "../refs/IOracleRef.sol";
import "../core/Core.sol";
import "./IOrchestrator.sol";

interface ITribe {
	function setMinter(address minter_) external;
}

// solhint-disable-next-line max-states-count
contract CoreOrchestrator is Ownable {
	address public admin;

	// ----------- Uniswap Addresses -----------
	address public constant ETH_USDC_UNI_PAIR = address(0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc);
	address public constant ROUTER = address(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);

	address public constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
	IUniswapV2Factory public constant UNISWAP_FACTORY = IUniswapV2Factory(0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f);

	address public ethFeiPair;
	address public tribeFeiPair;

	// ----------- Time periods -----------
	uint constant public RELEASE_WINDOW = 4 * 365 days;

	uint public constant TIMELOCK_DELAY = 2 days;
	uint public constant GENESIS_DURATION = 3 days;

	uint public constant POOL_DURATION = 2 * 365 days;
	uint public constant THAWING_DURATION = 4 weeks;

	uint public constant UNI_ORACLE_TWAP_DURATION = 10 minutes; // 10 min twap

	uint public constant BONDING_CURVE_INCENTIVE_DURATION = 1 days; // 1 day duration

	// ----------- Params -----------
	uint public constant EXCHANGE_RATE_DISCOUNT = 10;

	uint32 public constant INCENTIVE_GROWTH_RATE = 75; // a bit over 1 unit per 5 hours assuming 13s block time

	uint public constant SCALE = 100_000_000e18;
	uint public constant BONDING_CURVE_INCENTIVE = 500e18;

	uint public constant REWEIGHT_INCENTIVE = 500e18;
	uint public constant MIN_REWEIGHT_DISTANCE_BPS = 100;

	bool public constant USDC_PER_ETH_IS_PRICE_0 = false;


	uint public tribeSupply;
	uint public constant IDO_TRIBE_PERCENTAGE = 20;
	uint public constant GENESIS_TRIBE_PERCENTAGE = 10;
	uint public constant DEV_TRIBE_PERCENTAGE = 20;
	uint public constant STAKING_TRIBE_PERCENTAGE = 10;

	// ----------- Orchestrators -----------
	IPCVDepositOrchestrator private pcvDepositOrchestrator;
	IBondingCurveOrchestrator private bcOrchestrator;
	IIncentiveOrchestrator private incentiveOrchestrator;
	IControllerOrchestrator private controllerOrchestrator;
	IIDOOrchestrator private idoOrchestrator;
	IGenesisOrchestrator private genesisOrchestrator;
	IGovernanceOrchestrator private governanceOrchestrator;
	IRouterOrchestrator private routerOrchestrator;

	// ----------- Deployed Contracts -----------
	Core public core;
	address public fei;
	address public tribe;
	address public feiRouter;

	address public ethUniswapPCVDeposit;
	address public ethBondingCurve;
		
	address public uniswapOracle;
	address public bondingCurveOracle;

	address public uniswapIncentive;

	address public ethUniswapPCVController;

	address public ido;
	address public timelockedDelegator;

	address public genesisGroup;
	address public pool;

	address public governorAlpha;
	address public timelock;

	constructor(
		address _pcvDepositOrchestrator,
		address _bcOrchestrator, 
		address _incentiveOrchestrator, 
		address _controllerOrchestrator,
		address _idoOrchestrator,
		address _genesisOrchestrator, 
		address _governanceOrchestrator,
		address _routerOrchestrator,
		address _admin
	) public {
		core = new Core();

		require(_admin != address(0), "CoreOrchestrator: no admin");

		core.grantRevoker(_admin);

		pcvDepositOrchestrator = IPCVDepositOrchestrator(_pcvDepositOrchestrator);
		bcOrchestrator = IBondingCurveOrchestrator(_bcOrchestrator);
		incentiveOrchestrator = IIncentiveOrchestrator(_incentiveOrchestrator);
		idoOrchestrator = IIDOOrchestrator(_idoOrchestrator);
		controllerOrchestrator = IControllerOrchestrator(_controllerOrchestrator);
		genesisOrchestrator = IGenesisOrchestrator(_genesisOrchestrator);
		governanceOrchestrator = IGovernanceOrchestrator(_governanceOrchestrator);
		routerOrchestrator = IRouterOrchestrator(_routerOrchestrator);

		admin = _admin;
	}

	function initCore() public onlyOwner {
		core.init();

		tribe = address(core.tribe());
		fei = address(core.fei());
		tribeSupply = IERC20(tribe).totalSupply();
	}


	function initPairs() public onlyOwner {
		ethFeiPair = UNISWAP_FACTORY.createPair(fei, WETH);
		tribeFeiPair = UNISWAP_FACTORY.createPair(tribe, fei);
	}

	function initPCVDeposit() public onlyOwner() {
		(ethUniswapPCVDeposit, uniswapOracle) = pcvDepositOrchestrator.init(
			address(core),
			ethFeiPair,
			ROUTER,
			ETH_USDC_UNI_PAIR,
			UNI_ORACLE_TWAP_DURATION,
			USDC_PER_ETH_IS_PRICE_0
		);
		core.grantMinter(ethUniswapPCVDeposit);
		pcvDepositOrchestrator.detonate();
	}

	function initBondingCurve() public onlyOwner {
		(ethBondingCurve,
		 bondingCurveOracle) = bcOrchestrator.init(
			 address(core), 
			 uniswapOracle, 
			 ethUniswapPCVDeposit, 
			 SCALE, 
			 THAWING_DURATION,
			 BONDING_CURVE_INCENTIVE_DURATION,
			 BONDING_CURVE_INCENTIVE
		);
		core.grantMinter(ethBondingCurve);
		IOracleRef(ethUniswapPCVDeposit).setOracle(bondingCurveOracle);
		bcOrchestrator.detonate();
	}

	function initIncentive() public onlyOwner {
		uniswapIncentive = incentiveOrchestrator.init(
			address(core), 
			bondingCurveOracle, 
			ethFeiPair,
			ROUTER,
			INCENTIVE_GROWTH_RATE
		);
		core.grantMinter(uniswapIncentive);
		core.grantBurner(uniswapIncentive);
		IFei(fei).setIncentiveContract(ethFeiPair, uniswapIncentive);
		incentiveOrchestrator.detonate();
	}

	function initRouter() public onlyOwner {
		feiRouter = routerOrchestrator.init(ethFeiPair, WETH, uniswapIncentive);
		
		IUniswapIncentive(uniswapIncentive).setSellAllowlisted(feiRouter, true);
		IUniswapIncentive(uniswapIncentive).setSellAllowlisted(ethUniswapPCVDeposit, true);
		IUniswapIncentive(uniswapIncentive).setSellAllowlisted(ethUniswapPCVController, true);

	}

	function initController() public onlyOwner {
		ethUniswapPCVController = controllerOrchestrator.init(
			address(core), 
			bondingCurveOracle, 
			uniswapIncentive, 
			ethUniswapPCVDeposit, 
			ethFeiPair,
			ROUTER,
			REWEIGHT_INCENTIVE,
			MIN_REWEIGHT_DISTANCE_BPS
		);
		core.grantMinter(ethUniswapPCVController);
		core.grantPCVController(ethUniswapPCVController);
		
		IUniswapIncentive(uniswapIncentive).setExemptAddress(ethUniswapPCVDeposit, true);
		IUniswapIncentive(uniswapIncentive).setExemptAddress(ethUniswapPCVController, true);

		controllerOrchestrator.detonate();
	}

	function initIDO() public onlyOwner {
		(ido, timelockedDelegator) = idoOrchestrator.init(address(core), admin, tribe, tribeFeiPair, ROUTER, RELEASE_WINDOW);
		core.grantMinter(ido);
		core.allocateTribe(ido, tribeSupply * IDO_TRIBE_PERCENTAGE / 100);
		core.allocateTribe(timelockedDelegator, tribeSupply * DEV_TRIBE_PERCENTAGE / 100);
		idoOrchestrator.detonate();
	}

	function initGenesis() public onlyOwner {
		(genesisGroup, pool) = genesisOrchestrator.init(
			address(core), 
			ethBondingCurve, 
			ido,
			tribeFeiPair,
			bondingCurveOracle,
			GENESIS_DURATION,
			EXCHANGE_RATE_DISCOUNT,
			POOL_DURATION
		);
		core.setGenesisGroup(genesisGroup);
		core.allocateTribe(genesisGroup, tribeSupply * GENESIS_TRIBE_PERCENTAGE / 100);
		core.allocateTribe(pool, tribeSupply * STAKING_TRIBE_PERCENTAGE / 100);
		genesisOrchestrator.detonate();
	}

	function initGovernance() public onlyOwner {
		(governorAlpha, timelock) = governanceOrchestrator.init(
			admin, 
			tribe,
			TIMELOCK_DELAY
		);
		governanceOrchestrator.detonate();
		core.grantGovernor(timelock);
		ITribe(tribe).setMinter(timelock);
	}
}