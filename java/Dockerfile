FROM maven:3.9.11-eclipse-temurin-21

WORKDIR /lab

COPY grammar/upstream/PlSqlLexer.g4 grammar/upstream/PlSqlParser.g4 src/main/antlr4/
COPY java/src src/main/java/
COPY java/pom.xml .

RUN mvn -q -DskipTests package

ENTRYPOINT ["java", "-jar", "target/oracle-antlr-lab-java-0.1.0.jar"]
