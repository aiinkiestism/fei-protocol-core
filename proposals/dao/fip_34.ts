import { ethers } from 'hardhat';
import chai, { expect } from 'chai';
import CBN from 'chai-bn';
import {
  DeployUpgradeFunc,
  NamedContracts,
  SetupUpgradeFunc,
  TeardownUpgradeFunc,
  ValidateUpgradeFunc
} from '../../types/types';

chai.use(CBN(ethers.BigNumber));

// Constants
const TIMED_MINTER_FREQUENCY = '604800'; // weekly
const TIMED_MINTER_AMOUNT = ethers.constants.WeiPerEther.mul(25_000_000); // 25M FEI

/*

OA Minter

DEPLOY ACTIONS:

1. Deploy OwnableTimedMinter

DAO ACTIONS:
1. Make OwnableTimedMinter a minter
2. Mint initial 100M FEI
*/

export const deploy: DeployUpgradeFunc = async (deployAddress, addresses, logging = false) => {
  const { core, optimisticTimelock } = addresses;

  if (!core || !optimisticTimelock) {
    throw new Error('An environment variable contract address is not set');
  }

  // 1.
  const factory = await ethers.getContractFactory('OwnableTimedMinter');
  const optimisticMinter = await factory.deploy(core, optimisticTimelock, TIMED_MINTER_FREQUENCY, TIMED_MINTER_AMOUNT);

  await optimisticMinter.deployTransaction.wait();

  logging && console.log('optimisticMinter: ', optimisticMinter.address);

  return {
    optimisticMinter
  } as NamedContracts;
};

export const setup: SetupUpgradeFunc = async (addresses, oldContracts, contracts, logging) => {
  logging && console.log('No setup for FIP-35');
};

export const teardown: TeardownUpgradeFunc = async (addresses, oldContracts, contracts, logging) => {
  logging && console.log('No teardown for FIP-35');
};

export const validate: ValidateUpgradeFunc = async (addresses, oldContracts, contracts) => {
  const { fei, optimisticMinter, optimisticTimelock } = contracts;
  expect(await fei.balanceOf(optimisticTimelock.address)).to.be.bignumber.greaterThan(
    ethers.constants.WeiPerEther.mul(100_000_000)
  );
  expect(await optimisticMinter.owner()).to.be.equal(optimisticTimelock.address);
  expect(await optimisticMinter.isTimeStarted()).to.be.true;
};