const {
  BN,
  expectEvent,
  expectRevert,
  time,
  expect,
  getCore,
  getAddresses,
} = require('../../helpers');
  
const BondingCurve = artifacts.require('BondingCurve');
const Fei = artifacts.require('Fei');
const MockERC20PCVDeposit = artifacts.require('MockERC20PCVDeposit');
const MockERC20 = artifacts.require('MockERC20');
const MockOracle = artifacts.require('MockOracle');
  
describe('BondingCurve', function () {
  let userAddress;
  let secondUserAddress;
  let governorAddress;
  let beneficiaryAddress1;
  let beneficiaryAddress2;
  let keeperAddress;
  
  beforeEach(async function () {
    ({
      userAddress,
      governorAddress,
      secondUserAddress,
      keeperAddress,
      beneficiaryAddress1,
      beneficiaryAddress2,
	  } = await getAddresses());
    this.core = await getCore(true);
  
    this.fei = await Fei.at(await this.core.fei());
      
    this.oracle = await MockOracle.new(500); // 500 USD per ETH exchange rate 
    this.token = await MockERC20.new();

    this.pcvDeposit1 = await MockERC20PCVDeposit.new(beneficiaryAddress1, this.token.address);
    this.pcvDeposit2 = await MockERC20PCVDeposit.new(beneficiaryAddress2, this.token.address);
  
    this.scale = new BN('100000000000');
    this.buffer = new BN('100');
    this.incentiveAmount = new BN('100');
    this.incentiveDuration = new BN('10');
    this.bondingCurve = await BondingCurve.new(
      this.core.address, 
      this.oracle.address, 
      this.oracle.address, 
      this.scale, 
      [this.pcvDeposit1.address, this.pcvDeposit2.address], 
      [9000, 1000], 
      this.incentiveDuration, 
      this.incentiveAmount, 
      this.token.address, 
      100, 
      100
    );

    await this.token.mint(userAddress, '1000000000000000000000000');
    await this.core.grantMinter(this.bondingCurve.address, {from: governorAddress});

    await this.bondingCurve.setMintCap(this.scale.mul(new BN('10')), {from: governorAddress});
  });
  
  describe('Init', function() {
    it('current price', async function() {
      expect((await this.bondingCurve.getCurrentPrice())[0]).to.be.equal('1010101010101010101'); // ~1.01 FEI/$
    });
  
    it('getAmountOut', async function() {
      expect(await this.bondingCurve.getAmountOut('50000000')).to.be.bignumber.equal(new BN('25252525252'));
    });
  
    it('scale', async function() {
      expect(await this.bondingCurve.scale()).to.be.bignumber.equal(this.scale);
      expect(await this.bondingCurve.atScale()).to.be.equal(false);
    });
  
    it('balance', async function() {
      expect(await this.bondingCurve.balance()).to.be.bignumber.equal(new BN('0'));
    });
  
    it('totalPurchased', async function() {
      expect(await this.bondingCurve.totalPurchased()).to.be.bignumber.equal(new BN('0'));
    });
  
    it('buffer', async function() {
      expect(await this.bondingCurve.buffer()).to.be.bignumber.equal(this.buffer);
    });
  
    it('incentive amount', async function() {
      expect(await this.bondingCurve.incentiveAmount()).to.be.bignumber.equal(this.incentiveAmount);
    });
  });
  
  describe('Purchase', function() {
    beforeEach(async function() {
      this.purchaseAmount = new BN('50000000');
    });
  
    describe('Paused', function() {
      it('reverts', async function() {
        await this.bondingCurve.pause({from: governorAddress});
        await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
        await expectRevert(this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress}), 'Pausable: paused');
      });
    });
  
    describe('Correct Token amount sent', function() {
      describe('Invalid Oracle', function() {
        it('reverts', async function() {
          this.oracle.setValid(false);
          await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
          await expectRevert(this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress}), 'OracleRef: oracle invalid');     
        });
      });
  
      describe('Pre Scale', function() {
        beforeEach(async function() {
          this.expectedFei1 = new BN('25252525252');
          expect(await this.bondingCurve.getAmountOut(this.purchaseAmount)).to.be.bignumber.equal(this.expectedFei1);
          await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
          expectEvent(
            await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress}),
            'Purchase',
            {
              to: userAddress,
              amountIn: this.purchaseAmount,
              amountOut: this.expectedFei1
            }
          );
        });
  
        it('correct FEI sent', async function() {
          expect(await this.fei.balanceOf(userAddress)).to.be.bignumber.equal(this.expectedFei1);
        });
  
        it('totalPurchased', async function() {
          expect(await this.bondingCurve.totalPurchased()).to.be.bignumber.equal(this.expectedFei1);
        });
  
        it('not at Scale', async function() {
          expect(await this.bondingCurve.atScale()).to.be.equal(false);
        });
          
        it('current price', async function() {
          expect((await this.bondingCurve.getCurrentPrice()).value).to.be.equal('1010101010101010101');
        });
  
        it('total PCV held', async function() {
          expect(await this.bondingCurve.balance()).to.be.bignumber.equal(this.purchaseAmount);
        });
  
        describe('Second Purchase', function() {
          beforeEach(async function() {
            this.expectedFei2 = new BN('25252525252');
            this.totalExpected = this.expectedFei1.add(this.expectedFei2);
            await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
            expect(await this.bondingCurve.getAmountOut(this.purchaseAmount)).to.be.bignumber.equal(this.expectedFei2);
            expectEvent(
              await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress}),
              'Purchase',
              {
                to: userAddress,
                amountIn: this.purchaseAmount,
                amountOut: this.expectedFei2
              }
            );
          });
  
          it('correct FEI sent', async function() {
            expect(await this.fei.balanceOf(userAddress)).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('totalPurchased', async function() {
            expect(await this.bondingCurve.totalPurchased()).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('not at Scale', async function() {
            expect(await this.bondingCurve.atScale()).to.be.equal(false);
          });
            
          it('current price', async function() {
            expect((await this.bondingCurve.getCurrentPrice()).value).to.be.equal('1010101010101010101');
          });
    
          it('total PCV held', async function() {
            expect(await this.bondingCurve.balance()).to.be.bignumber.equal(this.purchaseAmount.mul(new BN(2)));
          });
        });
  
        describe('Purchase To', function() {
          beforeEach(async function() {
            this.expectedFei2 = new BN('25252525252');
            this.totalExpected = this.expectedFei1.add(this.expectedFei2);
            expect(await this.bondingCurve.getAmountOut(this.purchaseAmount)).to.be.bignumber.equal(this.expectedFei2);
            await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
            expectEvent(
              await this.bondingCurve.purchase(secondUserAddress, this.purchaseAmount, {from: userAddress}),
              'Purchase',
              {
                to: secondUserAddress,
                amountIn: this.purchaseAmount,
                amountOut: this.expectedFei2
              }
            );
          });
  
          it('correct FEI sent', async function() {
            expect(await this.fei.balanceOf(userAddress)).to.be.bignumber.equal(this.expectedFei1);
            expect(await this.fei.balanceOf(secondUserAddress)).to.be.bignumber.equal(this.expectedFei2);
          });
    
          it('totalPurchased', async function() {
            expect(await this.bondingCurve.totalPurchased()).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('not at Scale', async function() {
            expect(await this.bondingCurve.atScale()).to.be.equal(false);
          });
            
          it('current price', async function() {
            expect((await this.bondingCurve.getCurrentPrice()).value).to.be.equal('1010101010101010101');
          });
    
          it('total PCV held', async function() {
            expect(await this.bondingCurve.balance()).to.be.bignumber.equal(this.purchaseAmount.mul(new BN(2)));
          });
        });
  
        describe('Oracle Price Change', function() {
          beforeEach(async function() {
            // 20% reduction in exchange rate
            await this.oracle.setExchangeRate(400);
            this.expectedFei2 = new BN('20202020202');
            this.totalExpected = this.expectedFei1.add(this.expectedFei2);
            expect(await this.bondingCurve.getAmountOut(this.purchaseAmount)).to.be.bignumber.equal(this.expectedFei2);
            await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
            expectEvent(
              await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress}),
              'Purchase',
              {
                to: userAddress,
                amountIn: this.purchaseAmount,
                amountOut: this.expectedFei2
              }
            );
          });
  
          it('correct FEI sent', async function() {
            expect(await this.fei.balanceOf(userAddress)).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('totalPurchased', async function() {
            expect(await this.bondingCurve.totalPurchased()).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('not at Scale', async function() {
            expect(await this.bondingCurve.atScale()).to.be.equal(false);
          });
            
          it('current price', async function() {
            expect((await this.bondingCurve.getCurrentPrice()).value).to.be.equal('1010101010101010101');
          });
    
          it('total PCV held', async function() {
            expect(await this.bondingCurve.balance()).to.be.bignumber.equal(this.purchaseAmount.mul(new BN(2)));
          });
        });
      });
      describe('Exceeding cap', function() {
        it('reverts', async function() {
          this.purchaseAmount = new BN('4000000000');
          await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
          await expectRevert(
            this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress}),
            'BondingCurve: exceeds mint cap'
          );
        });
      });
      describe('Crossing Scale', function() {
        beforeEach(async function() {
          this.purchaseAmount = new BN('400000000');
          this.expectedFei1 = new BN('200020002000');
          expect(await this.bondingCurve.getAmountOut(this.purchaseAmount)).to.be.bignumber.equal(this.expectedFei1);
          await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
          expectEvent(
            await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress}),
            'Purchase',
            {
              to: userAddress,
              amountIn: this.purchaseAmount,
              amountOut: this.expectedFei1
            }
          );
        });
  
        it('correct FEI sent', async function() {
          expect(await this.fei.balanceOf(userAddress)).to.be.bignumber.equal(this.expectedFei1);
        });
  
        it('totalPurchased', async function() {
          expect(await this.bondingCurve.totalPurchased()).to.be.bignumber.equal(this.expectedFei1);
        });
  
        it('At Scale', async function() {
          expect(await this.bondingCurve.atScale()).to.be.equal(true);
        });
          
        it('current price', async function() {
          expect((await this.bondingCurve.getCurrentPrice()).value).to.be.equal('990099009900990099');
        });
  
        it('total PCV held', async function() {
          expect(await this.bondingCurve.balance()).to.be.bignumber.equal(this.purchaseAmount);
        });
  
        describe('Post Scale', function() {
          beforeEach(async function() {
            this.expectedFei2 = new BN('198019801980');
            this.totalExpected = this.expectedFei1.add(this.expectedFei2);
            expect(await this.bondingCurve.getAmountOut(this.purchaseAmount)).to.be.bignumber.equal(this.expectedFei2);
            await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
            expectEvent(
              await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress}),
              'Purchase',
              {
                to: userAddress,
                amountIn: this.purchaseAmount,
                amountOut: this.expectedFei2
              }
            );
          });
    
          it('correct FEI sent', async function() {
            expect(await this.fei.balanceOf(userAddress)).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('totalPurchased', async function() {
            expect(await this.bondingCurve.totalPurchased()).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('at Scale', async function() {
            expect(await this.bondingCurve.atScale()).to.be.equal(true);
          });
            
          it('current price', async function() {
            expect((await this.bondingCurve.getCurrentPrice()).value).to.be.equal('990099009900990099');
          });
    
          it('total PCV held', async function() {
            expect(await this.bondingCurve.balance()).to.be.bignumber.equal(this.purchaseAmount.mul(new BN(2)));
          });
  
          describe('reset', function() {
            beforeEach(async function() {
              expectEvent(
                await this.bondingCurve.reset({from: governorAddress}),
                'Reset',
                {}
              );
            });
  
            it('totalPurchased', async function() {
              expect(await this.bondingCurve.totalPurchased()).to.be.bignumber.equal(new BN('0'));
            });
  
            it('at Scale', async function() {
              expect(await this.bondingCurve.atScale()).to.be.equal(false);
            });
          });
        });
  
        describe('Buffer Change', function() {
          beforeEach(async function() {
            // 5% buffer
            await this.bondingCurve.setBuffer(500, {from: governorAddress});
            this.expectedFei2 = new BN('190476190476');
            this.totalExpected = this.expectedFei1.add(this.expectedFei2);
            expect(await this.bondingCurve.getAmountOut(this.purchaseAmount)).to.be.bignumber.equal(this.expectedFei2);
            await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
            expectEvent(
              await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress}),
              'Purchase',
              {
                to: userAddress,
                amountIn: this.purchaseAmount,
                amountOut: this.expectedFei2
              }
            );
          });
    
          it('correct FEI sent', async function() {
            expect(await this.fei.balanceOf(userAddress)).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('totalPurchased', async function() {
            expect(await this.bondingCurve.totalPurchased()).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('at Scale', async function() {
            expect(await this.bondingCurve.atScale()).to.be.equal(true);
          });
            
          it('current price', async function() {
            expect((await this.bondingCurve.getCurrentPrice()).value).to.be.equal('952380952380952380');
          });
    
          it('total PCV held', async function() {
            expect(await this.bondingCurve.balance()).to.be.bignumber.equal(this.purchaseAmount.mul(new BN(2)));
          });
        });
  
        describe('Oracle Price Change', function() {
          beforeEach(async function() {
            // 20% decrease
            await this.oracle.setExchangeRate(600);
            this.expectedFei2 = new BN('237623762376');
            this.totalExpected = this.expectedFei1.add(this.expectedFei2);
            expect(await this.bondingCurve.getAmountOut(this.purchaseAmount)).to.be.bignumber.equal(this.expectedFei2);
            await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
            expectEvent(
              await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress}),
              'Purchase',
              {
                to: userAddress,
                amountIn: this.purchaseAmount,
                amountOut: this.expectedFei2
              }
            );
          });
    
          it('correct FEI sent', async function() {
            expect(await this.fei.balanceOf(userAddress)).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('totalPurchased', async function() {
            expect(await this.bondingCurve.totalPurchased()).to.be.bignumber.equal(this.totalExpected);
          });
    
          it('at Scale', async function() {
            expect(await this.bondingCurve.atScale()).to.be.equal(true);
          });
            
          it('current price', async function() {
            expect((await this.bondingCurve.getCurrentPrice()).value).to.be.equal('990099009900990099');
          });
    
          it('total PCV held', async function() {
            expect(await this.bondingCurve.balance()).to.be.bignumber.equal(this.purchaseAmount.mul(new BN(2)));
          });
        });
      });
    });
  });
  
  describe('Allocate', function() {
    describe('Paused', function() {
      it('reverts', async function() {
        await this.bondingCurve.pause({from: governorAddress});
        await expectRevert(this.bondingCurve.allocate({from: keeperAddress}), 'Pausable: paused');
      });
    });
  
    describe('No Purchase', function() {
      it('reverts', async function() {
        await expectRevert(this.bondingCurve.allocate({from: keeperAddress}), 'BondingCurve: Not enough PCV held'); 
      });
    });
            
    describe('Purchase too low', function() {
      it('reverts', async function() {
        this.purchaseAmount = new BN('1');
        await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
        await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress});
        await expectRevert(this.bondingCurve.allocate({from: keeperAddress}), 'BondingCurve: Not enough PCV held'); 
      });
    });
  
    describe('With Purchase', function() {
      beforeEach(async function () {
        this.purchaseAmount = new BN('10000000');
        this.beneficiaryBalance1 = await this.token.balanceOf(beneficiaryAddress1);
        this.beneficiaryBalance2 = await this.token.balanceOf(beneficiaryAddress2);
  
        this.keeperFei = await this.fei.balanceOf(keeperAddress);
  
        await time.increase(this.incentiveDuration);
        await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});

        await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress});
        expectEvent(await this.bondingCurve.allocate({from: keeperAddress}),
          'Allocate',
          {
            caller: keeperAddress,
            amount: this.purchaseAmount
          }); 
      });
  
      it('splits funds', async function() {
        expect(await this.token.balanceOf(beneficiaryAddress1)).to.be.bignumber.equal(this.beneficiaryBalance1.add(new BN('9000000')));
        expect(await this.token.balanceOf(beneficiaryAddress2)).to.be.bignumber.equal(this.beneficiaryBalance2.add(new BN('1000000')));
      });
          
      it('incentivizes', async function() {
        expect(await this.fei.balanceOf(keeperAddress)).to.be.bignumber.equal(this.keeperFei.add(this.incentiveAmount));
      });
  
      describe('Second Allocate', async function() {
        describe('No Purchase', function() {
          it('reverts', async function() {
            await expectRevert(this.bondingCurve.allocate({from: keeperAddress}), 'BondingCurve: Not enough PCV held'); 
          });
        });
  
        describe('With Purchase Before Window', function() {
          beforeEach(async function () {
            this.beneficiaryBalance1 = await this.token.balanceOf(beneficiaryAddress1);
            this.beneficiaryBalance2 = await this.token.balanceOf(beneficiaryAddress2);
  
            this.keeperFei = await this.fei.balanceOf(keeperAddress);
            await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
            await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress});
            expectEvent(await this.bondingCurve.allocate({from: keeperAddress}),
              'Allocate',
              {
                caller: keeperAddress,
                amount: this.purchaseAmount
              }); 
          });
      
          it('splits funds', async function() {
            expect(await this.token.balanceOf(beneficiaryAddress1)).to.be.bignumber.equal(this.beneficiaryBalance1.add(new BN('9000000')));
            expect(await this.token.balanceOf(beneficiaryAddress2)).to.be.bignumber.equal(this.beneficiaryBalance2.add(new BN('1000000')));
          });
              
          it('no incentives', async function() {
            expect(await this.fei.balanceOf(keeperAddress)).to.be.bignumber.equal(this.keeperFei);
          });
        });
  
        describe('With Purchase After Window', function() {
          beforeEach(async function () {
            this.beneficiaryBalance1 = await this.token.balanceOf(beneficiaryAddress1);
            this.beneficiaryBalance2 = await this.token.balanceOf(beneficiaryAddress2);

            this.keeperFei = await this.fei.balanceOf(keeperAddress);
  
            await time.increase(this.incentiveDuration);
            await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
            await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress});
            expectEvent(await this.bondingCurve.allocate({from: keeperAddress}),
              'Allocate',
              {
                caller: keeperAddress,
                amount: this.purchaseAmount
              }); 
          });
      
          it('splits funds', async function() {
            expect(await this.token.balanceOf(beneficiaryAddress1)).to.be.bignumber.equal(this.beneficiaryBalance1.add(new BN('9000000')));
            expect(await this.token.balanceOf(beneficiaryAddress2)).to.be.bignumber.equal(this.beneficiaryBalance2.add(new BN('1000000')));
          });
              
          it('incentivizes', async function() {
            expect(await this.fei.balanceOf(keeperAddress)).to.be.bignumber.equal(this.keeperFei.add(this.incentiveAmount));
          });
        });
  
        describe('Updated Allocation', function() {
          beforeEach(async function() {
            this.beneficiaryBalance1 = await this.token.balanceOf(beneficiaryAddress1);
            this.beneficiaryBalance2 = await this.token.balanceOf(beneficiaryAddress2);
  
            this.keeperFei = await this.fei.balanceOf(keeperAddress);
  
            await time.increase(this.incentiveDuration);
            await this.bondingCurve.setAllocation([this.pcvDeposit1.address, this.pcvDeposit2.address], [5000, 5000], {from: governorAddress});

            await this.token.approve(this.bondingCurve.address, this.purchaseAmount, {from: userAddress});
            await this.bondingCurve.purchase(userAddress, this.purchaseAmount, {from: userAddress});
            expectEvent(await this.bondingCurve.allocate({from: keeperAddress}),
              'Allocate',
              {
                caller: keeperAddress,
                amount: this.purchaseAmount
              }); 
          });
    
          it('splits funds', async function() {
            expect(await this.token.balanceOf(beneficiaryAddress1)).to.be.bignumber.equal(this.beneficiaryBalance1.add(new BN('5000000')));
            expect(await this.token.balanceOf(beneficiaryAddress2)).to.be.bignumber.equal(this.beneficiaryBalance2.add(new BN('5000000')));
          });
            
          it('incentivizes', async function() {
            expect(await this.fei.balanceOf(keeperAddress)).to.be.bignumber.equal(this.keeperFei.add(this.incentiveAmount));
          });
        });
      });
    });
  });
  
  describe('PCV Allocation', function() {
    it('Mismatched lengths revert', async function() {
      await expectRevert(this.bondingCurve.checkAllocation([this.pcvDeposit1.address], [9000, 1000]), 'PCVSplitter: PCV Deposits and ratios are different lengths');
    });
  
    it('Incomplete allocation rule reverts', async function() {
      await expectRevert(this.bondingCurve.checkAllocation([this.pcvDeposit1.address, this.pcvDeposit2.address], [9000, 2000]), 'PCVSplitter: ratios do not total 100%');
    });
  
    it('Correct allocation rule succeeds', async function() {
      await this.bondingCurve.checkAllocation([this.pcvDeposit1.address, this.pcvDeposit2.address], [5000, 5000]);
    });
  
    it('Governor set succeeds', async function() {
      expectEvent(
        await this.bondingCurve.setAllocation([this.pcvDeposit1.address], [10000], {from: governorAddress}), 
        'AllocationUpdate', 
        { 
          oldPCVDeposits: [this.pcvDeposit1.address, this.pcvDeposit2.address],
          newPCVDeposits: [this.pcvDeposit1.address] 
        }
      );
  
      const result = await this.bondingCurve.getAllocation();
      expect(result[0].length).to.be.equal(1);
      expect(result[0][0]).to.be.equal(this.pcvDeposit1.address);
      expect(result[1].length).to.be.equal(1);
      expect(result[1][0]).to.be.bignumber.equal(new BN(10000));
    });
  
    it('Non-governor set reverts', async function() {
      await expectRevert(this.bondingCurve.setAllocation([this.pcvDeposit1.address], [10000], {from: userAddress}), 'CoreRef: Caller is not a governor');
    });
  });
  
  describe('Oracle', function() {
    it('Governor set succeeds', async function() {
      expectEvent(
        await this.bondingCurve.setOracle(userAddress, {from: governorAddress}),
        'OracleUpdate',
        {
          oldOracle: this.oracle.address,
          newOracle: userAddress
        }
      );
      expect(await this.bondingCurve.oracle()).to.be.equal(userAddress);
    });
  
    it('Non-governor set reverts', async function() {
      await expectRevert(this.bondingCurve.setOracle(userAddress, {from: userAddress}), 'CoreRef: Caller is not a governor');
    });
  });
  
  describe('Scale', function() {
    it('Governor set succeeds', async function() {
      expectEvent(
        await this.bondingCurve.setScale(100, {from: governorAddress}),
        'ScaleUpdate',
        { 
          oldScale: this.scale,
          newScale: new BN(100)
        }
      );
      expect(await this.bondingCurve.scale()).to.be.bignumber.equal(new BN(100));
    });
  
    it('Non-governor set reverts', async function() {
      await expectRevert(this.bondingCurve.setScale(100, {from: userAddress}), 'CoreRef: Caller is not a governor');
    });
  });
  
  describe('Buffer', function() {
    it('Governor set succeeds', async function() {
      expectEvent(
        await this.bondingCurve.setBuffer(1000, {from: governorAddress}),
        'BufferUpdate',
        {
          oldBuffer: this.buffer,
          newBuffer: new BN(1000)
        }
      );
      expect(await this.bondingCurve.buffer()).to.be.bignumber.equal(new BN(1000));
    });
  
    it('Governor set outside range reverts', async function() {
      await expectRevert(this.bondingCurve.setBuffer(10000, {from: governorAddress}), 'BondingCurve: Buffer exceeds or matches granularity');
    });
  
    it('Non-governor set reverts', async function() {
      await expectRevert(this.bondingCurve.setBuffer(1000, {from: userAddress}), 'CoreRef: Caller is not a governor');
    });
  });
  
  describe('Discount', function() {
    it('Governor set succeeds', async function() {
      expectEvent(
        await this.bondingCurve.setDiscount(1000, {from: governorAddress}),
        'DiscountUpdate',
        {
          oldDiscount: '100',
          newDiscount: new BN(1000)
        }
      );
      expect(await this.bondingCurve.discount()).to.be.bignumber.equal(new BN(1000));
    });
  
    it('Governor set outside range reverts', async function() {
      await expectRevert(this.bondingCurve.setDiscount(10000, {from: governorAddress}), 'BondingCurve: Buffer exceeds or matches granularity');
    });
  
    it('Non-governor set reverts', async function() {
      await expectRevert(this.bondingCurve.setDiscount(1000, {from: userAddress}), 'CoreRef: Caller is not a governor');
    });
  });
  
  describe('Core', function() {
    it('Governor set succeeds', async function() {
      expectEvent(
        await this.bondingCurve.setCore(userAddress, {from: governorAddress}), 
        'CoreUpdate', 
        {
          oldCore: this.core.address,
          newCore: userAddress
        }
      );
  
      expect(await this.bondingCurve.core()).to.be.equal(userAddress);
    });
  
    it('Non-governor set reverts', async function() {
      await expectRevert(this.bondingCurve.setCore(userAddress, {from: userAddress}), 'CoreRef: Caller is not a governor');
    });
  });
  
  describe('Incentive Amount', function() {
    it('Governor set succeeds', async function() {
      this.incentiveAmount = new BN('10');
      expectEvent(
        await this.bondingCurve.setIncentiveAmount(this.incentiveAmount, {from: governorAddress}), 
        'IncentiveUpdate', 
        { 
          oldIncentiveAmount: new BN('100'),
          newIncentiveAmount: this.incentiveAmount 
        }
      );
  
      expect(await this.bondingCurve.incentiveAmount()).to.be.bignumber.equal(this.incentiveAmount);
    });
  
    it('Non-governor set reverts', async function() {
      await expectRevert(this.bondingCurve.setIncentiveAmount(new BN('10'), {from: userAddress}), 'CoreRef: Caller is not a governor');
    });
  });
  
  describe('Incentive Frequency', function() {
    it('Governor set succeeds', async function() {
      this.incentiveFrequency = new BN('70');
      expectEvent(
        await this.bondingCurve.setIncentiveFrequency(this.incentiveFrequency, {from: governorAddress}), 
        'DurationUpdate', 
        { 
          oldDuration: this.incentiveDuration,
          newDuration: this.incentiveFrequency 
        }
      );
  
      expect(await this.bondingCurve.duration()).to.be.bignumber.equal(this.incentiveFrequency);
    });
  
    it('Non-governor set reverts', async function() {
      await expectRevert(this.bondingCurve.setIncentiveFrequency(new BN('10'), {from: userAddress}), 'CoreRef: Caller is not a governor');
    });
  });
  
  describe('Pausable', function() {
    it('init', async function() {
      expect(await this.bondingCurve.paused()).to.be.equal(false);
    });
  
    describe('Pause', function() {
      it('Governor succeeds', async function() {
        await this.bondingCurve.pause({from: governorAddress});
        expect(await this.bondingCurve.paused()).to.be.equal(true);
      });
  
      it('Non-governor reverts', async function() {
        await expectRevert(this.bondingCurve.pause({from: userAddress}), 'CoreRef: Caller is not a guardian or governor');
      });
    });
  
    describe('Unpause', function() {
      beforeEach(async function() {
        await this.bondingCurve.pause({from: governorAddress});
        expect(await this.bondingCurve.paused()).to.be.equal(true);
      });
  
      it('Governor succeeds', async function() {
        await this.bondingCurve.unpause({from: governorAddress});
        expect(await this.bondingCurve.paused()).to.be.equal(false);
      });
  
      it('Non-governor reverts', async function() {
        await expectRevert(this.bondingCurve.unpause({from: userAddress}), 'CoreRef: Caller is not a guardian or governor');
      });
    });
  });
});