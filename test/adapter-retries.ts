import { createAdapter } from "../lib/index";
import * as sinon from "sinon";
import expect from "expect.js";

describe("RedisAdapter retries", () => {
    it("should retry psubscribe call", async () => {
        const pubClient = {
            on: sinon.stub(),
            off: sinon.stub(),
            publish: sinon.stub(),
        };
        const subClient = {
            on: sinon.stub(),
            off: sinon.stub(),
            psubscribe: sinon.stub(),
            subscribe: sinon.stub(),
        };

        // Mock Redis v3 behavior (psubscribe is used)
        // Simulate 2 failures and 1 success
        subClient.psubscribe
            .onFirstCall()
            .rejects(new Error("timeout"))
            .onSecondCall()
            .rejects(new Error("timeout"))
            .onThirdCall()
            .resolves();

        // FIXED: Added server.encoder to mock
        const nsp = {
            name: "/",
            server: {
                encoder: {}
            },
            on: sinon.stub(),
            emit: sinon.stub(),
        };

        // Instantiate adapter
        createAdapter(pubClient, subClient)(nsp);

        // Wait for the async retry loop to complete
        await new Promise((resolve) => setTimeout(resolve, 1000));

        expect(subClient.psubscribe.callCount).to.be(3);
    });

    it("should retry pSubscribe call (Redis v4)", async () => {
        const pubClient = {
            on: sinon.stub(),
            off: sinon.stub(),
            publish: sinon.stub(),
            pSubscribe: sinon.stub(), // This presence triggers Redis v4 mode
        };
        const subClient = {
            on: sinon.stub(),
            off: sinon.stub(),
            pSubscribe: sinon.stub(),
            subscribe: sinon.stub(),
        };

        // Simulate 2 failures and 1 success
        subClient.pSubscribe
            .onFirstCall()
            .rejects(new Error("timeout"))
            .onSecondCall()
            .rejects(new Error("timeout"))
            .onThirdCall()
            .resolves();

        // FIXED: Added server.encoder to mock
        const nsp = {
            name: "/",
            server: {
                encoder: {}
            },
            on: sinon.stub(),
            emit: sinon.stub(),
        };

        // Instantiate adapter
        createAdapter(pubClient, subClient)(nsp);

        // Wait for the async retry loop to complete
        await new Promise((resolve) => setTimeout(resolve, 1000));

        expect(subClient.pSubscribe.callCount).to.be(3);
    });
});