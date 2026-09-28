package com.factorylm.mira;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MainActivityRecoveryTest {

    @Test
    public void repaintLadderNeverBackgroundsTheTask() {
        for (int attempt = 0; attempt < 4; attempt++) {
            assertTrue(MainActivity.shouldKickSurface(attempt));
        }

        assertFalse(MainActivity.shouldKickSurface(4));
        assertFalse(MainActivity.shouldKickSurface(5));
    }
}
