const EventTarget = require('event-target-shim');
const GuestList = require(
  '../../../../src/components/sharedspace/participation/guest-list'
).GuestList;

suite('Participation', () => {
  /* eslint-disable import/no-webpack-loader-syntax */
  const inject = require(
    'inject-loader!../../../../src/components/sharedspace/participation'
  );
  /* eslint-enable import/no-webpack-loader-syntax */

  let Participation;
  let participation;

  let GuestListSpy;
  let fakeRTCInterfaceCons, fakeRTCInterface;

  const nowFunction = Date.now;
  const now = 2;
  const youngerList = now + 1;
  const elderList = now - 1;
  const stream = new window.MediaStream();

  const enterGuests = new Set();

  function freeEventLoop () {
    return new Promise(resolve => {
      setTimeout(resolve);
    });
  }

  setup(() => {
    Date.now = () => now;

    GuestListSpy = sinon.spy(GuestList);
    GuestListSpy.copy = GuestList.copy;
    GuestListSpy.serialize = GuestList.serialize;
    GuestListSpy.deserialize = GuestList.deserialize;
    GuestListSpy.transformationCost = GuestList.transformationCost;

    fakeRTCInterfaceCons = class extends EventTarget {
      constructor (room, { id }) {
        super();
        this._connections = {};
        this._id = id;
        fakeRTCInterface = this;
      }

      connect () {
        this._connected = true;
        return Promise.resolve();
      }

      isConnected (id) {
        return this._connections[id];
      }

      get me () {
        return this._connected && (this._id || 'randomId');
      }

      fakeStream (from) {
        return this._emit('stream', { id: from, stream });
      }

      fakeConnection (id) {
        if (!this._connections[id]) {
          this._connections[id] = true;
          return this._emit('connect', { id });
        }
        return freeEventLoop();
      }

      fakeDisconnection (id) {
        if (this._connections[id]) {
          this._connections[id] = false;
          return this._emit('close', { id });
        }
        return freeEventLoop();
      }

      fakeList (from, timestamp, list) {
        return this.fakeConnection(from)
        .then(() => {
          this._emit('message', { type: 'list', from, timestamp, list });
        });
      }

      fakeContent (from, content) {
        return this.fakeConnection(from)
        .then(() => {
          this._emit('message', { type: 'content', from, content });
        });
      }

      _emit (type, detail) {
        return freeEventLoop()
        .then(() => {
          const event = new window.CustomEvent(type, { detail });
          fakeRTCInterface.dispatchEvent(event);
        });
      }

      broadcast () {}

      send () {}
    };

    sinon.spy(fakeRTCInterfaceCons.prototype, 'connect');
    sinon.spy(fakeRTCInterfaceCons.prototype, 'broadcast');
    sinon.spy(fakeRTCInterfaceCons.prototype, 'send');
    fakeRTCInterfaceCons = sinon.spy(fakeRTCInterfaceCons);

    Participation = inject({
      './guest-list': { GuestList: GuestListSpy },
      '../rtc-interface': { RTCInterface: fakeRTCInterfaceCons }
    }).Participation;

    participation =
      new Participation('testRoom', { stream, provider: 'test.com' });

    enterGuests.clear();
    participation.addEventListener('enterparticipant', ({ detail }) => {
      enterGuests.add(detail.id);
    });
  });

  teardown(() => {
    Date.now = nowFunction;
  });

  suite('constructor', () => {
    test('constructs a RTCInterface object without connecting', () => {
      assert.isTrue(fakeRTCInterfaceCons.calledWith('testRoom', {
        id: undefined,
        stream,
        signaling: 'test.com'
      }));
      assert.isTrue(fakeRTCInterface.connect.notCalled);
    });
  });

  suite('me property', () => {
    test('returns unknown before connecting', () => {
      assert.isUndefined(participation.me);
    });

    test('after connecting, returns the id passed in the constructor', () => {
      participation = new Participation('testRoom', {
        id: 'myId',
        stream,
        provider: 'test.com'
      });
      return participation.connect()
      .then(() => {
        assert.equal(participation.me, 'myId');
      });
    });

    test('after connecting, returns an autogenerated id if not passed in the constructor', () => {
      return participation.connect()
      .then(() => {
        assert.equal(participation.me, 'randomId');
      });
    });
  });

  suite('connect method', () => {
    test('instantiates a guest list with the local user as participant', () => {
      return participation.connect()
      .then(() => {
        assert.isTrue(GuestListSpy.calledOnce);
        assert.isTrue(GuestListSpy.calledWith(now, ['randomId']));
      });
    });

    test('emits connect event', done => {
      participation.addEventListener('connected', ({ detail }) => {
        assert.equal(detail.me, 'randomId');
        done();
      });
      participation.connect();
    });
  });

  suite('after connect', () => {
    setup(() => {
      return participation.connect();
    });

    suite('send method', () => {
      const message = {};

      test('broadcasts message when passing * as target', () => {
        participation.send('*', message);
        assert.isTrue(fakeRTCInterface.broadcast.calledOnce);
        assert.isTrue(fakeRTCInterface.broadcast.calledWith({
          type: 'content',
          content: message
        }));
      });

      test('sends a message when passing an id as target', () => {
        participation.send('id1', message);
        assert.isTrue(fakeRTCInterface.send.calledOnce);
        assert.isTrue(fakeRTCInterface.send.calledWith('id1', {
          type: 'content',
          content: message
        }));
      });
    });

    function becomeHost (onHost = () => {}) {
      return upgrade('host', ['remoteId', 'randomId'], onHost);
    }

    function becomeGuest () {
      return upgrade('guest', ['remoteId', 'randomId']);
    }

    function becomeDelayedGuest () {
      return upgrade('guest', ['remoteId', 'remoteId2', 'randomId']);
    }

    function upgrade (role, list, cb = () => {}) {
      let end;
      waitForUpgradeTo(role, () => { cb(); end(); });
      fakeRTCInterface.fakeList(
        'remoteId', role === 'host' ? youngerList : elderList, list
      );
      return new Promise(resolve => {
        end = resolve;
      });
    }

    function waitForUpgradeTo (role, cb) {
      participation.addEventListener('upgrade', function onUpgrade (evt) {
        participation.removeEventListener('upgrade', onUpgrade);
        assert.equal(evt.detail.role, role);
        cb();
      });
    }

    suite('if role is unknown', () => {
      suite('on RTC connect', () => {
        test('updates and broadcast list', () => {
          const onEnter = sinon.spy();
          participation.addEventListener('enterparticipant', onEnter);
          return fakeRTCInterface.fakeConnection('remoteId')
          .then(() => freeEventLoop())
          .then(() => {
            assert.isTrue(
              onEnter.notCalled,
              'should not emit enterparticipant'
            );
            assert.isTrue(fakeRTCInterface.broadcast.calledOnce);
            assert.isTrue(fakeRTCInterface.broadcast.calledWith({
              type: 'list',
              timestamp: now,
              list: ['randomId', 'remoteId']
            }));
          });
        });
      });

      suite('on RTC stream', () => {
        setup(() => {
          fakeRTCInterface.fakeStream('remoteId2');
        });

        test('holds the event until ending role negotiation (host)', () => {
          const onStream = sinon.spy(({ detail }) => {
            assert.equal(detail.id, 'remoteId2');
            assert.equal(detail.stream, stream);
          });
          participation.addEventListener('participantstream', onStream);
          return fakeRTCInterface.fakeConnection('remoteId2')
          .then(() => becomeHost())
          .then(() => freeEventLoop())
          .then(() => {
            assert.equal(
              onStream.callCount, 1,
              'participantstream not emitted'
            );
          });
        });

        test('holds the event until ending role negotiation (guest)', () => {
          const onStream = sinon.spy(({ detail }) => {
            assert.equal(detail.id, 'remoteId2');
            assert.equal(detail.stream, stream);
          });
          participation.addEventListener('participantstream', onStream);
          return fakeRTCInterface.fakeConnection('remoteId2')
          .then(() => becomeGuest())
          // Need to receive both connection and the updated list to finish
          // confirming presence of remoteId2.
          .then(() => fakeRTCInterface.fakeList(
            'remoteId', elderList, ['remoteId', 'randomId', 'remoteId2']
          ))
          .then(() => freeEventLoop())
          .then(() => {
            assert.equal(
              onStream.callCount, 1,
              'participantstream not emitted'
            );
          });
        });
      });

      suite('on RTC message', () => {
        test('becomes host after reciving a more recent guest list', () => {
          return becomeHost();
        });

        test('becomes guest after reciving an older guest list', () => {
          return becomeGuest();
        });

        suite('content messages', () => {
          setup(() => {
            return fakeRTCInterface.fakeConnection('remoteId', 'test');
          });

          test('holds the event until ending role negotiation (host)', () => {
            const onMessage = sinon.spy(({ detail }) => {
              assert.equal(detail.id, 'remoteId');
              assert.equal(detail.message, 'test');
            });
            participation.addEventListener('participantmessage', onMessage);
            return fakeRTCInterface.fakeContent('remoteId', 'test')
            .then(() => becomeHost())
            .then(() => freeEventLoop())
            .then(() => {
              assert.equal(
                onMessage.callCount, 1,
                'participantmessage not emitted'
              );
            });
          });

          test('holds the event until ending role negotiation (guest)', () => {
            const onMessage = sinon.spy(({ detail }) => {
              assert.equal(detail.id, 'remoteId');
              assert.equal(detail.message, 'test');
            });
            participation.addEventListener('participantmessage', onMessage);
            return fakeRTCInterface.fakeContent('remoteId', 'test')
            .then(() => becomeGuest())
            .then(() => freeEventLoop())
            .then(() => {
              assert.equal(
                onMessage.callCount, 1,
                'participantmessage not emitted'
              );
            });
          });
        });
      });

      suite('on RTC close', () => {
        test('ignores and broadcast the same list', () => {
          const onExit = sinon.spy();
          participation.addEventListener('exitparticipant', onExit);
          return fakeRTCInterface.fakeConnection('remoteId')
          .then(() => fakeRTCInterface.fakeDisconnection('remoteId'))
          .then(() => freeEventLoop())
          .then(() => {
            assert.isTrue(onExit.notCalled, 'should not emit exitparticipant');
            assert.isTrue(fakeRTCInterface.broadcast.calledTwice);
            const firstList = fakeRTCInterface.broadcast.getCall(0).args[0];
            const secondList = fakeRTCInterface.broadcast.getCall(1).args[0];
            assert.deepEqual(firstList, secondList);
          });
        });
      });
    });

    suite('if role is guest', () => {
      setup(() => {
        return becomeGuest()
        .then(() => {
          fakeRTCInterface.broadcast.reset();
        });
      });

      suite('on RTC connect', () => {
        test('ignores connection', () => {
          const onEnter = sinon.spy();
          participation.addEventListener('enterparticipant', onEnter);
          return fakeRTCInterface.fakeConnection('remoteId2')
          .then(() => freeEventLoop())
          .then(() => {
            assert.isTrue(
              onEnter.notCalled,
              'should not emit enterparticipant'
            );
            assert.isTrue(fakeRTCInterface.broadcast.notCalled);
          });
        });
      });

      suite('on RTC stream', () => {
        setup(() => {
          fakeRTCInterface.fakeStream('remoteId2');
        });

        test('enforces participantstream after enterparticipant', () => {
          const onStream = sinon.spy(({ detail }) => {
            assert.isTrue(enterGuests.has('remoteId2'));
          });
          participation.addEventListener('participantstream', onStream);

          // Need to receive both connection and the updated list to finish
          // confirming presence of remoteId2.
          return fakeRTCInterface.fakeConnection('remoteId2')
          .then(() => fakeRTCInterface.fakeList(
            'remoteId', elderList, ['remoteId', 'randomId', 'remoteId2']
          ))
          .then(() => freeEventLoop())
          .then(() => {
            assert.equal(
              onStream.callCount, 1, 'participantstream not emitted'
            );
            assert.isTrue(fakeRTCInterface.broadcast.notCalled);
          });
        });
      });

      suite('on RTC message', () => {
        suite('list messages', () => {
          test('ignores if the list comes from a peer other than host', () => {
            const onEnter = sinon.spy();
            participation.addEventListener('enterparticipant', onEnter);
            return fakeRTCInterface.fakeList(
              'remoteId2', elderList, ['remoteId', 'randomId', 'remoteId2']
            )
            .then(() => freeEventLoop())
            .then(() => {
              assert.isTrue(
                onEnter.notCalled,
                'should not emit enterparticipant'
              );
            });
          });

          test('advertises a participant is entering after receiving the list update and the participant connection', () => {
            const onEnter = sinon.spy(({ detail }) => {
              assert.equal(detail.id, 'remoteId2');
              assert.equal(detail.position, '3');
              assert.equal(detail.role, 'guest');
            });
            participation.addEventListener('enterparticipant', onEnter);
            return fakeRTCInterface.fakeList(
              'remoteId', elderList, ['remoteId', 'randomId', 'remoteId2']
            )
            .then(() => {
              return fakeRTCInterface.fakeConnection('remoteId2');
            })
            .then(() => freeEventLoop())
            .then(() => {
              assert.equal(
                onEnter.callCount, 1,
                'enterparticipant not emitted'
              );
            });
          });

          test('advertises a participant is entering after receiving the participant connection and the list update', () => {
            const onEnter = sinon.spy(({ detail }) => {
              assert.equal(detail.id, 'remoteId2');
              assert.equal(detail.position, '3');
              assert.equal(detail.role, 'guest');
            });
            participation.addEventListener('enterparticipant', onEnter);
            return fakeRTCInterface.fakeConnection('remoteId2')
            .then(() => {
              return fakeRTCInterface.fakeList(
                'remoteId', elderList, ['remoteId', 'randomId', 'remoteId2']
              );
            })
            .then(() => freeEventLoop())
            .then(() => {
              assert.equal(
                onEnter.callCount, 1,
                'enterparticipant not emitted'
              );
            });
          });

          test('ignores exitparticipant if no previous enterparticipant', () => {
            const onExit = sinon.spy();
            participation.addEventListener('exitparticipant', onExit);
            return fakeRTCInterface.fakeList(
              'remoteId', elderList, ['remoteId', 'randomId', 'remoteId2']
            )
            .then(() => fakeRTCInterface.fakeList(
              'remoteId', elderList, ['remoteId', 'randomId', null]
            ))
            .then(() => freeEventLoop())
            .then(() => {
              assert.isTrue(
                onExit.notCalled,
                'should not emit exitparticipant'
              );
            });
          });

          test('advertises a participant is leaving after receiving the list update (not waiting for the actual disconnection)', () => {
            const onExit = sinon.spy(({ detail }) => {
              assert.equal(detail.id, 'remoteId2');
              assert.equal(detail.position, '3');
              assert.equal(detail.role, 'guest');
            });
            participation.addEventListener('exitparticipant', onExit);
            return fakeRTCInterface.fakeConnection('remoteId2')
            .then(() => fakeRTCInterface.fakeList(
              'remoteId', elderList, ['remoteId', 'randomId', 'remoteId2']
            ))
            .then(() => fakeRTCInterface.fakeList(
              'remoteId', elderList, ['remoteId', 'randomId', null]
            ))
            .then(() => freeEventLoop())
            .then(() => {
              assert.equal(
                onExit.callCount, 1,
                'exitparticipant not emitted'
              );
            });
          });
        });

        suite('content messages', () => {
          test('enforces participantmessage after enterparticipant', () => {
            const onMessage = sinon.spy(({ detail }) => {
              assert.isTrue(enterGuests.has('remoteId'));
            });
            participation.addEventListener('participantmessage', onMessage);
            return fakeRTCInterface.fakeContent('remoteId', 'test')
            .then(() => freeEventLoop())
            .then(() => {
              assert.equal(
                onMessage.callCount, 1,
                'participantmessage not emitted'
              );
            });
          });
        });
      });

      suite('on RTC close', () => {
        setup(() => {
          return fakeRTCInterface.fakeConnection('remoteId2')
          .then(() => fakeRTCInterface.fakeList(
            'remoteId', elderList, ['remoteId', 'randomId', 'remoteId2']
          ));
        });

        test('if a guest peer is leaving, do nothing', () => {
          const onUpgrade = sinon.spy();
          participation.addEventListener('upgrade', onUpgrade);
          return fakeRTCInterface.fakeDisconnection('removeId2')
          .then(() => freeEventLoop())
          .then(() => {
            assert.isTrue(onUpgrade.notCalled, 'should not upgrade');
          });
        });

        test('if the host peer is leaving and local is next host, take over', () => {
          const onUpgrade = sinon.spy(({ detail }) => {
            assert.equal(detail.role, 'host');
          });
          participation.addEventListener('upgrade', onUpgrade);
          return fakeRTCInterface.fakeDisconnection('remoteId')
          .then(() => freeEventLoop())
          .then(() => {
            assert.equal(
              onUpgrade.callCount, 1,
              'upgrade to host did not happen'
            );
          });
        });

        test('if the host peer is leaving and local is not the next host, do nothing', () => {
          const onUpgrade = sinon.spy();
          participation =
            new Participation('testRoom', { stream, provider: 'test.com' });

          return participation.connect()
          .then(() => becomeDelayedGuest())
          .then(() => {
            participation.addEventListener('upgrade', onUpgrade);
            return fakeRTCInterface.fakeDisconnection('removeId2');
          })
          .then(() => freeEventLoop())
          .then(() => {
            assert.isTrue(onUpgrade.notCalled, 'should not upgrade');
          });
        });
      });
    });

    suite('if role is host, guest list heartbeat', () => {
      let clock;

      setup(() => {
        return becomeHost(() => {
          clock = sinon.useFakeTimers();
        })
        .then(() => {
          fakeRTCInterface.broadcast.reset();
        });
      });

      teardown(() => {
        clock.restore();
      });

      test('send the guest list every 3 seconds', () => {
        clock.tick(10000);
        assert.isTrue(fakeRTCInterface.broadcast.calledThrice);
        for (let i = 0; i < 3; i++) {
          const call = fakeRTCInterface.broadcast.getCall(i);
          assert.deepEqual(call.args[0], {
            type: 'list',
            timestamp: now,
            list: ['randomId', 'remoteId']
          });
        }
      });
    });

    suite('if role is host', () => {
      setup(() => {
        return becomeHost()
        .then(() => {
          fakeRTCInterface.broadcast.reset();
        });
      });

      suite('on RTC connect', () => {
        test('advertises a participant is entering', () => {
          const onEnter = sinon.spy(({ detail }) => {
            assert.equal(detail.id, 'remoteId2');
            assert.equal(detail.position, '3');
            assert.equal(detail.role, 'guest');
            assert.isTrue(fakeRTCInterface.broadcast.calledWith({
              type: 'list',
              timestamp: now,
              list: ['randomId', 'remoteId', 'remoteId2']
            }));
          });
          participation.addEventListener('enterparticipant', onEnter);
          return fakeRTCInterface.fakeConnection('remoteId2')
          .then(() => freeEventLoop())
          .then(() => {
            assert.equal(
              onEnter.callCount, 1,
              'enterparticipant not emitted'
            );
          });
        });
      });

      suite('on RTC stream', () => {
        setup(() => {
          fakeRTCInterface.fakeStream('remoteId2');
        });

        test('enforces participantstream after enterparticipant', () => {
          const onStream = sinon.spy(({ detail }) => {
            assert.isTrue(enterGuests.has('remoteId2'));
          });
          participation.addEventListener('participantstream', onStream);
          return fakeRTCInterface.fakeConnection('remoteId2')
          .then(() => freeEventLoop())
          .then(() => {
            assert.equal(
              onStream.callCount, 1,
              'participantstream not emitted'
            );
          });
        });
      });

      suite('on RTC message', () => {
        suite('list messages', () => {
          test('ignores lists', () => {
            const onEnter = sinon.spy();
            participation.addEventListener('enterparticipant', onEnter);
            return fakeRTCInterface.fakeList(
              'remoteId', elderList, ['remoteId', 'randomId', 'remoteId2']
            )
            .then(() => freeEventLoop())
            .then(() => {
              assert.isTrue(
                onEnter.notCalled,
                'should not emit enterparticipant'
              );
            });
          });
        });

        suite('content messages', () => {
          test('enforces participantmessage after enterparticipant', () => {
            const onMessage = sinon.spy(({ detail }) => {
              assert.isTrue(enterGuests.has('remoteId'));
            });
            participation.addEventListener('participantmessage', onMessage);
            return fakeRTCInterface.fakeContent('remoteId', 'test')
            .then(() => freeEventLoop())
            .then(() => {
              assert.equal(
                onMessage.callCount, 1,
                'participantmessage not emitted'
              );
            });
          });
        });
      });

      suite('on RTC close', () => {
        setup(() => {
          return fakeRTCInterface.fakeConnection('remoteId2');
        });

        test('advertises a participant is exiting and broadcast the list', () => {
          const onExit = sinon.spy(({ detail }) => {
            assert.isTrue(enterGuests.has('remoteId2'));
            assert.equal(detail.id, 'remoteId2');
            assert.equal(detail.position, '3');
            assert.equal(detail.role, 'guest');
          });
          participation.addEventListener('exitparticipant', onExit);
          return fakeRTCInterface.fakeDisconnection('remoteId2')
          .then(() => freeEventLoop())
          .then(() => {
            assert.equal(onExit.callCount, 1, 'exitparticipant not emitted');
            assert.isTrue(fakeRTCInterface.broadcast.calledWith({
              type: 'list',
              timestamp: now,
              list: ['randomId', 'remoteId', null]
            }));
          });
        });
      });
    });
  });
});
