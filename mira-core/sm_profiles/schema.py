"""SM Profile schema — typed equipment nodes (vision doc Problem 4).

An SM Profile is a versioned JSON document describing a class of
industrial equipment: its measurable properties (with units + ranges +
alarm thresholds) and its valid relationships to other equipment.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

EdgeType = Literal["partOf", "adjacentTo", "monitoredBy", "feedsInto"]


class SmProperty(BaseModel):
    name: str = Field(min_length=1)
    engineeringUnit: str = Field(min_length=1)
    normalRangeMin: float
    normalRangeMax: float
    alarmHigh: float
    alarmLow: float
    description: str = ""

    @model_validator(mode="after")
    def _check_ranges(self) -> "SmProperty":
        if self.normalRangeMin >= self.normalRangeMax:
            raise ValueError(
                f"{self.name}: normalRangeMin ({self.normalRangeMin}) must be "
                f"< normalRangeMax ({self.normalRangeMax})"
            )
        if self.alarmLow > self.normalRangeMin:
            raise ValueError(
                f"{self.name}: alarmLow ({self.alarmLow}) must be "
                f"<= normalRangeMin ({self.normalRangeMin})"
            )
        if self.alarmHigh < self.normalRangeMax:
            raise ValueError(
                f"{self.name}: alarmHigh ({self.alarmHigh}) must be "
                f">= normalRangeMax ({self.normalRangeMax})"
            )
        return self


class SmRelationship(BaseModel):
    edge: EdgeType
    targetType: str = Field(min_length=1)


class SmProfile(BaseModel):
    type: str = Field(min_length=1)
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    description: str = ""
    properties: list[SmProperty] = Field(min_length=1)
    relationships: list[SmRelationship] = []
