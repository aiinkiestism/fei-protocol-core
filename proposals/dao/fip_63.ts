import hre, { ethers } from 'hardhat';
import chai, { expect } from 'chai';
import CBN from 'chai-bn';
import { DeployUpgradeFunc, SetupUpgradeFunc, TeardownUpgradeFunc, ValidateUpgradeFunc } from '@custom-types/types';

chai.use(CBN(ethers.BigNumber));

const eth = ethers.constants.WeiPerEther;
const toBN = ethers.BigNumber.from;

/*
FIP-62
DEPLOY ACTIONS:

1. Deploy lusdPSM
  -- target of WETH PSM will be compoundEthPCVDeposit
  -- reserve threshold will be 250 eth
  -- mint fee 50 basis points
  -- redeem fee 20 basis points
2. Deploy PSM Router

DAO ACTIONS:
1. Grant the lusdPSM the minter role
2. Hit the secondary pause switch so redemptions are paused
3. Pause the WETH compound PCV Drip controller
4. Point the aave eth PCV Drip controller to the lusdPSM
5. Pause eth redeemer
6. Pause eth reserve stabilizer
*/

const decimalsNormalizer = 0;
const doInvert = false;

const mintFeeBasisPoints = 25;
const redeemFeeBasisPoints = 25;
const reservesThreshold = toBN(10_000_000).mul(eth);
const feiMintLimitPerSecond = ethers.utils.parseEther('10000');
const lusdPSMBufferCap = ethers.utils.parseEther('10000000');

const incentiveAmount = 0;

const lusdDripAmount = ethers.utils.parseEther('50000000');
const dripDuration = 1800;

export const deploy: DeployUpgradeFunc = async (deployAddress, addresses, logging = false) => {
  const { bammDeposit, core, chainlinkLUSDOracleWrapper, lusd } = addresses;

  if (!core) {
    throw new Error('An environment variable contract address is not set');
  }

  // 1. Deploy eth PSM
  const lusdPSM = await (
    await ethers.getContractFactory('GranularPegStabilityModule')
  ).deploy(
    {
      coreAddress: core,
      oracleAddress: chainlinkLUSDOracleWrapper,
      backupOracle: chainlinkLUSDOracleWrapper,
      decimalsNormalizer,
      doInvert
    },
    mintFeeBasisPoints,
    redeemFeeBasisPoints,
    reservesThreshold,
    feiMintLimitPerSecond,
    lusdPSMBufferCap,
    lusd,
    bammDeposit
  );

  const lusdPCVDripController = await (
    await ethers.getContractFactory('PCVDripController')
  ).deploy(core, bammDeposit, lusdPSM.address, dripDuration, lusdDripAmount, incentiveAmount);

  await lusdPSM.deployTransaction.wait();
  logging && console.log('ethPegStabilityModule: ', lusdPSM.address);

  return {
    lusdPSM,
    lusdPCVDripController
  };
};

export const setup: SetupUpgradeFunc = async (addresses, oldContracts, contracts, logging) => {
  const { bondingCurve } = contracts;

  /// give the bonding curve a balance so that the ratioPCVControllerV2 doesn't revert in the dao script
  await hre.network.provider.send('hardhat_setBalance', [bondingCurve.address, '0x21E19E0C9BAB2400000']);
  logging && console.log('Sent eth to bonding curve so ratioPCVController withdraw');
};

export const teardown: TeardownUpgradeFunc = async (addresses, oldContracts, contracts, logging) => {
  logging && console.log('No teardown');
};

export const validate: ValidateUpgradeFunc = async (addresses, oldContracts, contracts) => {
  const { lusdPCVDripController, lusdPSM, pcvGuardian, bammDeposit, lusd } = contracts;

  expect(await lusdPCVDripController.source()).to.be.equal(bammDeposit.address);
  expect(await lusdPCVDripController.target()).to.be.equal(lusdPSM.address);
  expect(await lusdPCVDripController.dripAmount()).to.be.equal(lusdDripAmount);
  expect(await lusdPCVDripController.incentiveAmount()).to.be.equal(incentiveAmount);
  expect(await lusdPCVDripController.duration()).to.be.equal(dripDuration);
  expect(await lusdPCVDripController.paused()).to.be.true;

  expect(await lusdPSM.surplusTarget()).to.be.equal(bammDeposit.address);
  expect(await lusdPSM.redeemFeeBasisPoints()).to.be.equal(redeemFeeBasisPoints);
  expect(await lusdPSM.mintFeeBasisPoints()).to.be.equal(mintFeeBasisPoints);
  expect(await lusdPSM.reservesThreshold()).to.be.equal(reservesThreshold);
  expect((await lusdPSM.underlyingToken()).toLowerCase()).to.be.equal(lusd.address.toLowerCase());
  expect(await lusdPSM.bufferCap()).to.be.equal(lusdPSMBufferCap);
  expect(await lusdPSM.redeemPaused()).to.be.true;
  expect(await lusdPSM.paused()).to.be.true;
  expect(await lusdPSM.balance()).to.be.equal(0);

  expect(await lusd.balanceOf(lusdPSM.address)).to.be.equal(0);

  expect(await pcvGuardian.isSafeAddress(lusdPSM.address)).to.be.true;
};
